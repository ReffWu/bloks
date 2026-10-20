// "Seen by", as the window keeps it: each conversation's read positions
// (server/reads.ts), seeded from its history and kept current by the
// server's "read" frames, and the one thing this window says back: how
// far its person has read, once the messages are really on screen.
//
// Shared by the owner's chat and room and by a member's app, which hear
// frames through different streams and post to different routes; both
// hand them in here, so the drawing is the same everywhere.
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { ReadMark } from "./participants";

const byThread = new Map<string, ReadMark[]>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** One person's place, kept only when it is news: a mark for somebody
 * already further on (by time) is an old word arriving late. */
function keep(threadId: string, mark: ReadMark): boolean {
  const list = byThread.get(threadId) ?? [];
  const was = list.find((r) => r.personId === mark.personId);
  if (was && (was.messageId === mark.messageId || was.at > mark.at)) return false;
  byThread.set(threadId, [...list.filter((r) => r.personId !== mark.personId), mark]);
  return true;
}

/** What a history route said about a conversation, as it loaded. */
export function seedReads(threadId: string, reads: unknown) {
  if (!Array.isArray(reads)) return;
  let moved = false;
  for (const r of reads as Array<Partial<ReadMark>>) {
    if (typeof r?.personId === "string" && typeof r.messageId === "string" && typeof r.at === "number") {
      moved = keep(threadId, { personId: r.personId, messageId: r.messageId, at: r.at }) || moved;
    }
  }
  if (moved) changed();
}

/** A frame from either stream; anything but "read" is not ours. */
export function takeReadFrame(frame: { kind?: unknown; threadId?: unknown; personId?: unknown; messageId?: unknown; at?: unknown }) {
  if (frame.kind !== "read" || typeof frame.threadId !== "string") return;
  if (typeof frame.personId !== "string" || typeof frame.messageId !== "string" || typeof frame.at !== "number") return;
  if (keep(frame.threadId, { personId: frame.personId, messageId: frame.messageId, at: frame.at })) changed();
}

const EMPTY: ReadMark[] = [];

/** A conversation's positions, current. */
export function useReads(threadId: string | null): ReadMark[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  return (threadId && byThread.get(threadId)) || EMPTY;
}

/** How long the reader's place has to hold still before it is said: a
 * scroll past a message is not reading it. */
const SETTLE_MS = 900;

/**
 * Says how far this window's person has read, as they read: the last
 * message row (`[data-read-id]`) whose words are in view in `scroller`,
 * while the window is in front and focused, once it has held for a
 * moment. Never more than once for the same place, and never backwards
 * within the conversation open here (the server keeps it forward too).
 */
export function useReadPosition({
  threadId,
  scroller,
  enabled,
  post,
  tick,
}: {
  threadId: string | null;
  scroller: RefObject<HTMLElement | null>;
  enabled: boolean;
  post: (threadId: string, messageId: string) => Promise<unknown>;
  /** Changes as messages arrive, so a new one in view is noticed. */
  tick: unknown;
}) {
  const said = useRef<{ threadId: string; messageId: string } | null>(null);
  const postRef = useRef(post);
  postRef.current = post;

  useEffect(() => {
    if (!enabled || !threadId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rows = () => [...(scroller.current?.querySelectorAll<HTMLElement>("[data-read-id]") ?? [])];
    const lastInView = (): string | null => {
      const box = scroller.current?.getBoundingClientRect();
      if (!box) return null;
      let found: string | null = null;
      for (const row of rows()) {
        const r = row.getBoundingClientRect();
        // its first line is on screen: enough of it to have been read
        if (r.top < box.bottom - 12 && r.bottom > box.top) found = row.dataset.readId ?? found;
      }
      return found;
    };
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState !== "visible" || !document.hasFocus()) return;
        const id = lastInView();
        if (!id) return;
        const was = said.current?.threadId === threadId ? said.current.messageId : null;
        if (was === id) return;
        if (was) {
          const ids = rows().map((r) => r.dataset.readId);
          const at = ids.indexOf(was);
          if (at !== -1 && ids.indexOf(id) <= at) return;
        }
        said.current = { threadId, messageId: id };
        void postRef.current(threadId, id).catch(() => {
          // said again next time something moves
          if (said.current?.messageId === id) said.current = null;
        });
      }, SETTLE_MS);
    };
    const el = scroller.current;
    el?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      if (timer) clearTimeout(timer);
      el?.removeEventListener("scroll", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, threadId, scroller, tick]);
}
