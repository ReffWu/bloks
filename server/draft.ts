// A whole agent, drafted from one sentence.
//
// Naming an agent was already a model call. Everything else on the
// creation screen was left to the keyword matcher, which is good when a
// description happens to look like one of the built-in roles and does
// nothing at all when it does not. "browse digital stores and find the
// best deals" is the second kind, and an empty persona is the worst
// possible starting point: the agent has no craft, and the person has
// nothing to react to.
//
// So the same call drafts the role, the persona and a few skills. The
// reply is labelled lines rather than JSON, because small models get
// labelled lines right far more often than they get nested JSON right,
// and a draft that fails to parse is a draft nobody sees.
//
// What comes back is read as a proposal from something that does not
// always listen: each field is checked for the shape it was asked for,
// and one that misses is dropped rather than shown, so the screen keeps
// its own guess for that field instead of a worse one.

export interface Draft {
  name?: string;
  title?: string;
  description?: string;
  skills: string[];
  /** Skills from the workspace's library that fit the job, by id. Only
   * ever ids the library has; see draftPrompt's `library`. */
  skillIds?: string[];
}

export const DRAFT_LIMITS = {
  name: 32,
  title: 60,
  description: 1_200,
  skill: 200,
  skills: 5,
  library: 3,
} as const;

/** A skill in the workspace's library, as the prompt offers it. */
export interface LibrarySkill {
  id: string;
  name: string;
  description: string;
}

export interface DraftContext {
  /** Names already in use, which the name must not repeat. */
  taken?: readonly string[];
  /** The library to pick from. Empty or absent asks for no picks. */
  library?: readonly LibrarySkill[];
  /** Names an earlier draft for the same job offered, for "another". */
  avoid?: readonly string[];
  /** The letter the name starts with. Left to itself a small model
   * names nearly every agent Alex, so the caller picks one at random. */
  initial?: string;
}

/** Letters plenty of first names start with, in most languages. */
export const NAME_INITIALS = "ABCDEFGHIJKLMNOPRSTVWZ";

export function randomInitial(): string {
  return NAME_INITIALS[Math.floor(Math.random() * NAME_INITIALS.length)];
}

/** The most library skills offered to the model: each one is prompt the
 * person waits on, and a long list makes a small model pick loosely. */
const LIBRARY_OFFERED = 24;

/** What we ask for. Kept here so the parser and the prompt cannot drift. */
export function draftPrompt(description: string, context: DraftContext = {}): string {
  const avoid = [...new Set([...(context.taken ?? []), ...(context.avoid ?? [])].map((n) => n.trim()).filter(Boolean))].slice(0, 40);
  const library = (context.library ?? []).slice(0, LIBRARY_OFFERED);
  return [
    "You are setting up a new AI agent for someone. The job, in their words:",
    `"${description.trim()}"`,
    "",
    "Reply with labelled lines and nothing else: no preamble, no markdown, no numbering. Use these labels exactly:",
    "NAME: one human first name that suits this person's role, the way a colleague is called (like Maya, Theo, Priya, Omar). Never a job title or a description.",
    "TITLE: what they do, 2 to 6 words, sentence case, no full stop. Specific to this job, like \"Keeps the inbox at zero\".",
    "PERSONA: 2 or 3 sentences to the agent, starting \"You\". Say what they own, how they do it, and the one thing they never do. Concrete to this job; do not repeat the job sentence or use the name.",
    "SKILL: one concrete skill in one sentence, a short name then what they do and hand back, like \"Morning sweep: each morning, list what needs a reply today with a draft for each\".",
    ...(library.length
      ? [
          "LIBRARY: the ids from the list below that clearly fit this job, comma separated, at most 3, or none.",
          "",
          "Library:",
          ...library.map((s) => `- ${s.id}: ${s.name}. ${oneLine(s.description).slice(0, 120)}`),
        ]
      : []),
    "",
    "Give 3 to 5 SKILL lines.",
    ...(context.initial && /^[A-Z]$/.test(context.initial) ? [`The NAME starts with the letter ${context.initial}.`] : []),
    ...(avoid.length ? [`The NAME must not be any of: ${avoid.join(", ")}.`] : []),
  ].join("\n");
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const strip = (value: string) => value.replace(/^["'`*\s]+|["'`*\s]+$/g, "").trim();

/**
 * Read the labelled reply.
 *
 * Everything is optional: a model that returns only a name still gives
 * a better screen than no call at all, and the caller falls back field
 * by field. A PERSONA that runs over several lines is joined, because
 * models wrap prose whether or not they were asked to.
 */
export function parseDraft(raw: string, context: DraftContext = {}): Draft {
  const draft: Draft = { skills: [] };
  const personaLines: string[] = [];
  const picked: string[] = [];
  let inPersona = false;

  for (const line of raw.split("\n")) {
    // a model that bolds its labels ("**NAME:**") still means them
    const labelled = line.replace(/\*\*/g, "").match(/^\s*(NAME|TITLE|PERSONA|SKILL|LIBRARY)\s*:\s*(.*)$/i);
    if (labelled) {
      const label = labelled[1].toUpperCase();
      const value = strip(labelled[2]);
      inPersona = label === "PERSONA";
      if (label === "NAME" && value) draft.name = value;
      else if (label === "TITLE" && value) draft.title = value;
      else if (label === "PERSONA" && value) personaLines.push(value);
      else if (label === "SKILL" && value) draft.skills.push(value);
      else if (label === "LIBRARY" && value) picked.push(...value.split(/[,\s]+/));
      continue;
    }
    // An unlabelled line continues the persona and is otherwise ignored,
    // which quietly drops the "Here you go!" a model likes to open with.
    if (inPersona && line.trim()) personaLines.push(strip(line));
  }

  if (personaLines.length) draft.description = personaLines.join(" ").trim();
  if (picked.length) draft.skillIds = picked;
  return clampDraft(draft, context);
}

/** Cut at a word boundary where there is one near the end, so a trimmed
 * line reads as shortened rather than broken. */
function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, max);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.-]+$/, "").trim();
}

/** A person's first name, or nothing: one or two words of letters, the
 * first capitalised, and not a name already in use. A role ("Inbox
 * Manager") is what the local guess already gives, so a model that
 * answers with one has added nothing and is dropped. */
function personName(raw: string, avoid: ReadonlySet<string>): string | undefined {
  const value = oneLine(raw).replace(/[.!,;:]+$/, "");
  if (!/^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*)?$/u.test(value) || value.length > DRAFT_LIMITS.name) return undefined;
  const name = value
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  if (avoid.has(name.toLowerCase())) return undefined;
  if (/\b(agent|assistant|manager|bot|helper|specialist|coordinator|analyst|writer|planner|tracker)\b/i.test(name)) return undefined;
  return name;
}

/** Every field a model wrote reaches a config file and a system prompt,
 * so each one is checked and cut to a length rather than trusted. */
export function clampDraft(draft: Draft, context: DraftContext = {}): Draft {
  const avoid = new Set([...(context.taken ?? []), ...(context.avoid ?? [])].map((n) => n.trim().toLowerCase()));
  const name = draft.name ? personName(draft.name, avoid) : undefined;
  const title = draft.title
    ? cut(oneLine(draft.title).replace(/\.$/, ""), DRAFT_LIMITS.title).replace(/^./, (c) => c.toUpperCase())
    : undefined;
  // two words is a fragment, not a persona; better the screen's own
  const description = draft.description && oneLine(draft.description).split(" ").length >= 6
    ? cut(oneLine(draft.description), DRAFT_LIMITS.description)
    : undefined;
  const seen = new Set<string>();
  const skills = draft.skills
    // written like the built-in roles' skills: no bullet, no full stop
    .map((skill) => cut(oneLine(skill.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")).replace(/\.$/, ""), DRAFT_LIMITS.skill))
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (skill.length < 4 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, DRAFT_LIMITS.skills);
  const known = new Set((context.library ?? []).map((s) => s.id));
  const skillIds = [...new Set((draft.skillIds ?? []).map((id) => strip(id).toLowerCase()))]
    .filter((id) => known.has(id))
    .slice(0, DRAFT_LIMITS.library);
  return {
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    skills,
    ...(skillIds.length ? { skillIds } : {}),
  };
}

/** The key a draft is kept under: the same job typed with other spacing
 * or capitals is the same job. */
export function draftKey(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Drafts already written, and ones being written, by job. Typing pauses
 * and resumes, a person goes back and forward between beats, and two
 * windows can ask at once; each of those used to be another model call
 * the person waited on. Kept in memory only, and small.
 */
export class DraftCache {
  private done = new Map<string, { draft: Draft; at: number }>();
  private pending = new Map<string, Promise<Draft>>();
  private readonly size: number;
  private readonly ttlMs: number;

  constructor(size = 64, ttlMs = 30 * 60_000) {
    this.size = size;
    this.ttlMs = ttlMs;
  }

  /** A kept draft, or the one already on its way, or a new one from
   * `make`. `fresh` skips what was kept, for "another suggestion". */
  get(key: string, make: () => Promise<Draft>, fresh = false): Promise<Draft> {
    if (!fresh) {
      const kept = this.done.get(key);
      if (kept && Date.now() - kept.at < this.ttlMs) {
        // read again counts as used again, so the busy ones stay
        this.done.delete(key);
        this.done.set(key, kept);
        return Promise.resolve(kept.draft);
      }
      const coming = this.pending.get(key);
      if (coming) return coming;
    }
    const made = make().then(
      (draft) => {
        if (this.pending.get(key) === made) this.pending.delete(key);
        // an empty draft is a failed call, not an answer worth keeping
        if (draft.name || draft.title || draft.description || draft.skills.length) {
          this.done.delete(key);
          this.done.set(key, { draft, at: Date.now() });
          while (this.done.size > this.size) this.done.delete(this.done.keys().next().value!);
        }
        return draft;
      },
      (error) => {
        if (this.pending.get(key) === made) this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, made);
    return made;
  }
}
