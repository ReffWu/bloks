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

export type NewKind = "business" | "custom";

/** A name as the main process will keep it: one line, no runs of
 * spaces. Length is the field's own limit. */
export function cleanDraftName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** The name a draft will be made with: what was typed, or "Business". */
export function draftName(kind: NewKind, name: string): string {
  return cleanDraftName(name) || (kind === "business" ? "Business" : "");
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
    return { ready: false, problem: "There is a Business workspace already." };
  }
  if (list.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
    return { ready: false, problem: `There is a workspace called ${name} already.` };
  }
  return { ready: true, problem: null };
}
