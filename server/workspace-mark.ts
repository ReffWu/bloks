// The workspace's mark, as the owner's phone reads and changes it.
//
// The desktop app keeps every workspace's mark in its list and draws the
// switcher from it (electron/workspaces.mjs); this server keeps its own
// copy beside its name (server/members.ts workspace.json), which is what
// a phone, an invite and a member's app see. A change made at the Mac is
// handed to this server by the app. A change made on the phone comes
// here, and is put to the app, which is the one that knows whether
// another workspace on this computer already wears that mark; only its
// yes is kept, and the app hands the same mark back to this server as it
// would for a change at the Mac. A server with no app behind it decides
// alone.
//
// The colours and shapes are the picker's (electron/workspace-marks.mjs).
// The server cannot import the app's files, so they are written out here
// too, and test/workspace-mark-choice.test.ts holds the two lists to each
// other.
import type { WorkspaceIdentity } from "./members.ts";
import type { LineAnswer } from "./desktop-line.ts";

export interface Mark {
  color: string;
  pattern: string;
}

export const PERSONAL_DEFAULT: Readonly<Mark> = Object.freeze({ color: "#E9A83A", pattern: "010111101" });
export const BUSINESS_DEFAULT: Readonly<Mark> = Object.freeze({ color: "#3E5BD9", pattern: "111101111" });

/** The picker's colours, in its order. */
export const CHOICE_COLORS: readonly string[] = Object.freeze([
  PERSONAL_DEFAULT.color,
  BUSINESS_DEFAULT.color,
  "#149E8E",
  "#8E4FC9",
  "#E8664A",
  "#D64C7F",
  "#2A86C7",
  "#7A8F2A",
  "#B86A3C",
  "#4D6478",
  "#3F9A5B",
  "#5B5F6B",
]);

/** The picker's shapes, in its order. */
export const CHOICE_PATTERNS: readonly string[] = Object.freeze([
  PERSONAL_DEFAULT.pattern,
  BUSINESS_DEFAULT.pattern,
  "101010101",
  "010111010",
  "010101010",
  "111010010",
  "100100111",
  "100110111",
  "101101111",
  "110010011",
  "111000111",
  "101000101",
]);

const lit = (pattern: string) => [...pattern].filter((b) => b === "1").length;

/** A mark somebody may choose, cleaned, or null. The same rule as the
 * app's isChoosableMark: a picker colour, and a picker shape or any
 * shape a drawn mark could have. */
export function choosableMark(raw: unknown): Mark | null {
  const m = raw as { color?: unknown; pattern?: unknown } | null;
  if (!m || typeof m.color !== "string" || typeof m.pattern !== "string") return null;
  const color = CHOICE_COLORS.find((c) => c.toUpperCase() === (m.color as string).toUpperCase());
  if (!color || !/^[01]{9}$/.test(m.pattern)) return null;
  const drawable = lit(m.pattern) >= 4 && lit(m.pattern) <= 7 && m.pattern !== PERSONAL_DEFAULT.pattern && m.pattern !== BUSINESS_DEFAULT.pattern;
  if (!CHOICE_PATTERNS.includes(m.pattern) && !drawable) return null;
  return { color, pattern: m.pattern };
}

/** The default a kind's mark goes back to, by the kind the app started
 * this server as; null for a workspace whose mark was drawn for it. */
export function defaultForKind(kind: string | undefined): Mark | null {
  if (kind === "business") return { ...BUSINESS_DEFAULT };
  // a server on its own is Personal (server/members.ts workspaceIdentity)
  if (!kind || kind === "personal") return { ...PERSONAL_DEFAULT };
  return null;
}

const same = (a: Mark | null, b: Mark | null) => Boolean(a && b && a.color.toUpperCase() === b.color.toUpperCase() && a.pattern === b.pattern);

export interface MarkRouteDeps {
  identity(): WorkspaceIdentity;
  /** The default as the app last said it, else by kind. */
  markDefault(): Mark | null;
  /** Keeps a mark here, with the default when the app gave one. */
  save(mark: Mark, markDefault?: Mark | null): void;
  /** Puts a change to the app; null when there is no app. */
  askApp(mark: Mark | null): Promise<LineAnswer> | null;
  broadcast(frame: object): void;
}

/** What the phone is shown: the mark, what it would go back to, whether
 * somebody chose it, and what may be chosen. */
export function markView(deps: Pick<MarkRouteDeps, "identity" | "markDefault">) {
  const ws = deps.identity();
  const markDefault = deps.markDefault();
  return {
    workspace: { id: ws.id, name: ws.name },
    mark: ws.mark,
    default: markDefault,
    chosen: !same(ws.mark, markDefault),
    choices: { colors: CHOICE_COLORS, patterns: CHOICE_PATTERNS },
  };
}

/**
 * GET and PUT /api/workspace/mark. The caller has already made sure it is
 * the owner, at this computer or on a device of theirs: never an agent,
 * never a member, whose own choice of mark stays on their side.
 */
export async function markRoute(
  method: string,
  path: string,
  readBody: () => Promise<Record<string, unknown>>,
  deps: MarkRouteDeps,
): Promise<{ status: number; body: unknown } | null> {
  if (path !== "/api/workspace/mark") return null;
  if (method === "GET") return { status: 200, body: markView(deps) };
  if (method !== "PUT") return { status: 405, body: { error: "GET or PUT /api/workspace/mark" } };
  const body = await readBody();
  if (!("mark" in body)) return { status: 400, body: { error: "mark is { color, pattern }, or null for the default" } };
  const asked = body.mark === null ? null : choosableMark(body.mark);
  if (body.mark !== null && !asked) return { status: 400, body: { error: "That is not a mark a workspace can have." } };

  const app = deps.askApp(asked);
  if (app) {
    const said = await app;
    if (said.error) return { status: typeof said.status === "number" ? said.status : 409, body: { error: said.error } };
    const mark = choosableMark(said.mark) ?? asked;
    if (!mark) return { status: 502, body: { error: "The Bloks app on this computer answered without a mark." } };
    const markDefault = said.markDefault === null ? null : (choosableMark(said.markDefault) ?? undefined);
    deps.save(mark, markDefault);
  } else {
    const mark = asked ?? deps.markDefault();
    if (!mark) return { status: 409, body: { error: "This workspace's mark was drawn for it. Choose another." } };
    deps.save(mark);
  }
  const view = markView(deps);
  deps.broadcast({ kind: "workspace.mark", mark: view.mark, default: view.default, chosen: view.chosen });
  return { status: 200, body: view };
}
