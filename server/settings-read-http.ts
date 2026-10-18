import type { IncomingMessage, ServerResponse } from "node:http";
import { SettingsPages, type SettingsCategory } from "./settings-pages.ts";

/** Who is reading, as the server's guard already decided it. Members and
 * invite holders never get this far: the guard hands them their own small
 * surface before any owner route is matched. */
export type SettingsReader = { role: "owner" | "agent"; identity: string };

export const DEVICE_CATEGORIES: ReadonlySet<string> = new Set(["device.browser", "device.native", "device.phone"]);
/** A report is a few kilobytes; anything near this is not one. */
export const MAX_REPORT_BYTES = 16_384;

export function noStore(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Only the narrow route uses this projection. Caller identity is produced
 * by the existing authenticated request boundary, never a body/query field. */
export function serveSettingsRead(
  reader: SettingsReader, method: string, query: URLSearchParams, res: ServerResponse,
  pages: SettingsPages,
  records: (category: SettingsCategory) => { id: string; visible: boolean; project: () => object }[],
): void {
  if (method !== "GET") return noStore(res, 405, { error: "settings inspection only accepts GET" });
  try {
    const result = pages.read(query, reader.identity, records);
    noStore(res, result.status, result.body);
  } catch {
    noStore(res, 503, { error: "settings observations are unavailable" });
  }
}

/** Bound bytes before parsing, and never retain or quote an oversized
 * body. An early refusal drains what is left without buffering it. */
export async function readReport(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REPORT_BYTES) { req.resume(); throw new Error("invalid settings report"); }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
