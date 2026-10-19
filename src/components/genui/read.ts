// Reading props an agent wrote. While an answer streams a component can
// arrive with half its props, and after it a model can still pass a
// number where a word was meant, so nothing a renderer reads is assumed.

export interface Element {
  type: "element";
  typeName: string;
  props: Record<string, unknown>;
  statementId?: string;
}

export function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element" &&
    typeof (value as { typeName?: unknown }).typeName === "string";
}

/** Words, from a string or a number; anything else is no words. */
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The components in a list, in order, skipping anything that is not one. */
export function elements(value: unknown, typeName?: string): Element[] {
  return list(value).filter((item): item is Element => isElement(item) && (!typeName || item.typeName === typeName));
}

export function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** An image the app may load. The page's content policy allows only its
 * own addresses and inline data, and an image fetched from anywhere an
 * agent names is a way to send what it read to that address. */
export function localImage(src: unknown): string | null {
  const value = text(src).trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) return value;
  if (value.startsWith("/api/") && !value.startsWith("//")) return value;
  return null;
}

/** Numbers as people write them: thousands grouped, nothing silly after
 * the point. */
export function figure(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 });
}
