// What the New workspace dialog says about what has been typed: whether
// Create can work, and if not, the one sentence that says why, for under
// the field it is about. The main process holds the same rules and has
// the last word (electron/workspaces.mjs refusal); this is so the dialog
// never offers a Create that would only be refused.
//
// The workspace being made is its own exception. The list the window
// holds is told about it the moment it exists, while the window is still
// on its way to it, and a dialog that read that list as it stood once
// called its own new workspace's name taken.
import { t } from "./i18n.ts";

export type NewKind = "business" | "custom";

/** A name as the main process will keep it: one line, no runs of
 * spaces. Length is the field's own limit. */
export function cleanDraftName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** The name a draft will be made with: what was typed, or "Business" in
 * the reader's language, the name the dialog showed it with. */
export function draftName(kind: NewKind, name: string): string {
  return cleanDraftName(name) || (kind === "business" ? businessName() : "");
}

/** What a Business workspace is called until it is given a name. */
export function businessName(): string {
  return t("newWorkspace.businessName");
}

/** Which field an answer from the main process is about, so its sentence
 * sits under that field rather than at the foot of the dialog: the name
 * (taken, empty, a second Business), who uses it (a Team workspace needs
 * your name first), the mark, or the dialog as a whole. */
export function errorPlace(error: string, code?: string): "name" | "team" | "mark" | "form" {
  if (code === "name_required") return "team";
  if (/\bmark\b/i.test(error)) return "mark";
  if (/called .+ already|Give it a name|Business workspace already|name of its own/i.test(error)) return "name";
  return "form";
}

export interface DraftCheck {
  /** Create can work as it stands. */
  ready: boolean;
  /** Why not, in a sentence for under the name; null when there is
   * nothing worth saying (an empty field is not a mistake yet). */
  problem: string | null;
}

/**
 * Whether a draft can be made, against the workspaces on this computer.
 * `making` is the name of the workspace being made right now, if one
 * is: nothing more is said about the field while it is.
 */
export function checkDraft(
  draft: { kind: NewKind; name: string },
  list: ReadonlyArray<{ name: string; kind: string }>,
  making: string | null = null,
): DraftCheck {
  if (making !== null) return { ready: false, problem: null };
  const name = draftName(draft.kind, draft.name);
  if (!name) return { ready: false, problem: null };
  if (draft.kind === "business" && list.some((w) => w.kind === "business")) {
    return { ready: false, problem: t("newWorkspace.businessExists") };
  }
  if (list.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
    return { ready: false, problem: t("newWorkspace.nameTaken", { name }) };
  }
  return { ready: true, problem: null };
}
