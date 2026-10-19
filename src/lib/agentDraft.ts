// A model's draft of a new agent, asked for while the job is still being
// typed, so it is usually there by the time the person moves on.
//
// The screen never waits on it. Its own guess (src/lib/agentTemplates.ts)
// shows at once; the draft, when it lands, takes over only the fields the
// person has not typed into. Every pause in typing would otherwise be a
// call, so asking waits for the typing to settle, a newer job stops the
// call for an older one, and a job already drafted is not asked twice.
// The server keeps drafts too (server/draft.ts); this saves the trip.

export interface AgentDraft {
  name?: string;
  title?: string;
  description?: string;
  skills: string[];
  /** Skills from the workspace's library that fit the job, by id. */
  skillIds?: string[];
}

/** What the screen shows and the draft may fill. */
export interface DraftFields {
  name: string;
  title: string;
  description: string;
  skills: string[];
  skillIds: string[];
}
export type DraftField = keyof DraftFields;

/** How long typing has to rest before a draft is asked for. */
export const DRAFT_SETTLE_MS = 500;

/** Too little to draft from yet: one word is still being typed, and the
 * screen's own guess is as good as a model's on it. */
export function worthDrafting(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && text.trim().length >= 8;
}

/** The same job with other spacing or capitals is the same job. */
export function draftKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The reply as this screen will use it. It came over the wire, so only
 * the shapes asked for are kept. */
export function asDraft(raw: unknown): AgentDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim())) : []);
  const ids = list(r.skillIds);
  return {
    ...(text(r.name) ? { name: text(r.name) } : {}),
    ...(text(r.title) ? { title: text(r.title) } : {}),
    ...(text(r.description) ? { description: text(r.description) } : {}),
    skills: list(r.skills),
    ...(ids.length ? { skillIds: ids } : {}),
  };
}

const said = (draft: AgentDraft) =>
  Boolean(draft.name || draft.title || draft.description || draft.skills.length || draft.skillIds?.length);

/**
 * The fields after a draft lands. Whatever the person typed into stays
 * theirs; every other field takes the draft's, where the draft has one,
 * and keeps what it had where the draft is silent. `filled` is which
 * fields now show the draft's words, for the "Suggested" hint.
 */
export function mergeDraft(
  current: DraftFields,
  draft: AgentDraft,
  edited: ReadonlySet<string>,
): { fields: DraftFields; filled: DraftField[] } {
  const offered: Partial<DraftFields> = {
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.title ? { title: draft.title } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.skills.length ? { skills: draft.skills } : {}),
    ...(draft.skillIds?.length ? { skillIds: draft.skillIds } : {}),
  };
  const filled = (Object.keys(offered) as DraftField[]).filter((field) => !edited.has(field));
  const fields = { ...current };
  for (const field of filled) Object.assign(fields, { [field]: offered[field] });
  return { fields, filled };
}

type Fetcher = (body: { description: string; again?: boolean; avoid?: string[] }, signal: AbortSignal) => Promise<unknown>;

/**
 * Asks for drafts and remembers them. One call at a time: asking for a
 * different job aborts the call still out for the last one, which is
 * stale the moment the words change. Asking for the job already on its
 * way joins that call instead of starting another.
 */
export function createDrafter(fetcher: Fetcher) {
  const kept = new Map<string, AgentDraft>();
  let out: { key: string; controller: AbortController; promise: Promise<AgentDraft> } | null = null;
  return {
    /** The draft already in hand for this job, if any. */
    kept: (text: string) => kept.get(draftKey(text)),
    /** The draft for this job: kept, on its way, or asked for now.
     * `again` asks for a different one, avoiding the names given. */
    ask(text: string, options: { again?: boolean; avoid?: string[] } = {}): Promise<AgentDraft> {
      const key = draftKey(text);
      if (!options.again) {
        const have = kept.get(key);
        if (have) return Promise.resolve(have);
        if (out?.key === key) return out.promise;
      }
      out?.controller.abort();
      const controller = new AbortController();
      const body = {
        description: text.trim(),
        ...(options.again ? { again: true, avoid: (options.avoid ?? []).filter(Boolean).slice(0, 10) } : {}),
      };
      const promise = fetcher(body, controller.signal)
        .then((raw) => {
          const draft = asDraft(raw);
          // an empty draft is a call that failed quietly, not an answer
          if (said(draft)) kept.set(key, draft);
          return draft;
        })
        .finally(() => {
          if (out?.promise === promise) out = null;
        });
      out = { key, controller, promise };
      return promise;
    },
    /** Stops whatever is out, as the screen closes. */
    stop() {
      out?.controller.abort();
      out = null;
    },
  };
}
