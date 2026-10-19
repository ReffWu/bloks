// What a click in an agent's interface answer does.
//
// Deliberately little. A button can say something back to the agent that
// drew it, open a web page, or change what the answer itself shows. It
// cannot fetch, run a tool, or reach anywhere else: the interface is part
// of a reply, and a reply has no permissions of its own. So the renderer
// hands every action here, and this decides which of three things
// happens, or that nothing does.
//
//   Said back: @ToAssistant, a button with no action, a follow-up, a
//   choice, a form sent. It becomes a new message from the person to the
//   same agent, in the same conversation or room, with what was filled in
//   written out the way a person would read it, because it is their
//   message in the transcript.
//
//   Opened: @OpenUrl, for http and https only. Anything else a model
//   writes there (javascript:, file:, an app's own scheme) is the first
//   thing an injected instruction would try.
//
//   Nothing: @Run, Query, Mutation and custom actions are not part of
//   this library, and a button that asks for one does nothing.
//
// Pure, so the routing is tested without a window (test/genui-actions).

/** The action event the renderer hands over (OpenUI's ActionEvent). */
export interface GenUiEvent {
  type: string;
  params?: Record<string, unknown>;
  humanFriendlyMessage?: string;
  formName?: string;
  formState?: Record<string, unknown>;
}

/** Where the answer was drawn, and so where its words go back to. */
export type GenUiTarget =
  | { kind: "chat"; botId: string }
  /** A room: the words go to the room, addressed to the agent that drew
   * the answer, so it is that agent who replies rather than the lead. */
  | { kind: "room"; roomId: string; agentName?: string };

export type GenUiOutcome =
  | { kind: "send"; botId: string; text: string }
  | { kind: "room"; roomId: string; text: string }
  | { kind: "open"; url: string }
  | { kind: "none" };

/** Names for what a form holds, as the person saw them: a field's label,
 * and an option's label for its value. */
export interface GenUiLabels {
  field(name: string): string | undefined;
  option(name: string, value: string): string | undefined;
  /** Where a field sits on screen, for the order it is written out in. */
  order(name: string): number;
}

const NO_LABELS: GenUiLabels = { field: () => undefined, option: () => undefined, order: () => Number.MAX_SAFE_INTEGER };

/** Longest message one click can send. */
export const MAX_SAID = 4_000;

/** An address that may be opened: http or https, and nothing else. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** "party_size" reads as "Party size". */
function humane(name: string): string {
  const words = name.replace(/^\$/, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : name;
}

/** A field's value as a sentence fragment, or null when it is empty. */
function readable(name: string, raw: unknown, labels: GenUiLabels): string | null {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? (raw as { value: unknown }).value : raw;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return labels.option(name, value) ?? value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "string" ? (labels.option(name, v) ?? v) : String(v))).filter(Boolean);
    if (!parts.length) return null;
    // a range, from a slider or a pair of dates, reads as one
    return parts.length === 2 ? `${parts[0]} to ${parts[1]}` : parts.join(", ");
  }
  if (typeof value === "object") {
    // a group of checkboxes: the ones ticked
    const ticked = Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => on === true)
      .map(([key]) => labels.option(name, key) ?? humane(key));
    return ticked.length ? ticked.join(", ") : "None";
  }
  return null;
}

/** What a form held when it was sent, one line a field, in screen order. */
export function formLines(formState: Record<string, unknown> | undefined, formName: string | undefined, labels: GenUiLabels = NO_LABELS): string[] {
  if (!formName || !formState) return [];
  const fields = formState[formName];
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.entries(fields as Record<string, unknown>)
    .sort(([a], [b]) => labels.order(a) - labels.order(b))
    .flatMap(([name, raw]) => {
      const said = readable(name, raw, labels);
      return said === null ? [] : [`${labels.field(name) ?? humane(name)}: ${said}`];
    });
}

/**
 * The words one click sends: the button's message, what the form held,
 * and any context the agent attached to it. Outside a form only the
 * message goes, because what else is on the page (which tab is open) is
 * the interface's business, not something the person said.
 */
export function saidBack(event: GenUiEvent, labels: GenUiLabels = NO_LABELS): string {
  const message = (event.humanFriendlyMessage ?? "").trim();
  const lines = formLines(event.formState, event.formName, labels);
  const context = event.params?.context;
  const extra =
    context === undefined || context === null || context === ""
      ? ""
      : typeof context === "string"
        ? context.trim()
        : JSON.stringify(context);
  const text = [message, lines.join("\n"), extra.slice(0, 500)].filter(Boolean).join("\n\n");
  return text.length > MAX_SAID ? `${text.slice(0, MAX_SAID - 1)}…` : text;
}

/** What one action event does, from where it was drawn. */
export function routeAction(event: GenUiEvent, target: GenUiTarget | null, labels: GenUiLabels = NO_LABELS): GenUiOutcome {
  if (event.type === "open_url") {
    const url = safeHttpUrl(event.params?.url);
    return url ? { kind: "open", url } : { kind: "none" };
  }
  if (event.type !== "continue_conversation" || !target) return { kind: "none" };
  const text = saidBack(event, labels);
  if (!text) return { kind: "none" };
  if (target.kind === "chat") return { kind: "send", botId: target.botId, text };
  return { kind: "room", roomId: target.roomId, text: target.agentName ? `@${target.agentName} ${text}` : text };
}
