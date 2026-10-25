// Hand-written twin of attention-said.mjs, so the tests typecheck against
// the same shapes the main process uses.

export interface AttentionWord {
  mute: number | "forever" | null;
  notify: "all" | "needs-me" | "nothing";
}

export function attentionWord(ws: { mute?: AttentionWord["mute"] | null; notify?: AttentionWord["notify"] | null } | null | undefined): AttentionWord;

export interface AttentionSayer {
  say(id: string, where: { kind: string; base: string }, word: { mute?: AttentionWord["mute"] | null; notify?: AttentionWord["notify"] | null }): Promise<void>;
  forget(id: string): void;
}

export function createAttentionSayer(options: {
  file: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;
  timeoutMs?: number;
}): AttentionSayer;
