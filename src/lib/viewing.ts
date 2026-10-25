// What this window has in front of the person, said to its server.
//
// The person's phone is told when an answer they waited on is ready,
// unless they are reading that conversation already (server/answer-ready.ts).
// Reading here is a conversation open in a window that is shown and
// focused, said again every thirty seconds while it stays so, and said
// to be over the moment it is not: hidden, blurred, another conversation
// opened, the window gone. A computer that sleeps stops saying it, and
// the server stops believing it soon after.
import { useEffect, useRef } from "react";

/** The server's own number (VIEWING_EVERY_MS). */
export const VIEWING_EVERY_MS = 30_000;

/** This window's id for as long as it is open. A reload is a new window. */
function newViewer(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `w-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** What to say right now: the conversation when it is on screen, else null. */
export function onScreen(threadId: string | null, page: { visible: boolean; focused: boolean }): string | null {
  return threadId && page.visible && page.focused ? threadId : null;
}

/**
 * Says what this window shows. `post` sends one word; a server too old
 * to hear it (404), or one this window is not the owner's screen on
 * (403), is not asked again until the page reloads.
 */
export function useViewingReport(threadId: string | null, post: (body: { viewer: string; threadId: string | null; seq: number }) => Promise<unknown>) {
  const viewer = useRef<string | null>(null);
  const seq = useRef(0);
  const deaf = useRef(false);
  const postRef = useRef(post);
  postRef.current = post;

  useEffect(() => {
    viewer.current ??= newViewer();
    let last: string | null | undefined;
    const say = (force = false) => {
      if (deaf.current) return;
      const now = onScreen(threadId, { visible: document.visibilityState === "visible", focused: document.hasFocus() });
      // a word that changes nothing goes only as the heartbeat of a
      // conversation still on screen
      if (!force && now === last) return;
      if (force && now === null && last === null) return;
      last = now;
      seq.current += 1;
      void postRef.current({ viewer: viewer.current!, threadId: now, seq: seq.current }).catch((error: unknown) => {
        const status = (error as { status?: unknown })?.status;
        if (status === 404 || status === 403) deaf.current = true;
      });
    };
    const changed = () => say();
    say();
    const beat = setInterval(() => say(true), VIEWING_EVERY_MS);
    window.addEventListener("focus", changed);
    window.addEventListener("blur", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      clearInterval(beat);
      window.removeEventListener("focus", changed);
      window.removeEventListener("blur", changed);
      document.removeEventListener("visibilitychange", changed);
      // leaving this conversation, for another or for none
      if (last) {
        seq.current += 1;
        void postRef.current({ viewer: viewer.current!, threadId: null, seq: seq.current }).catch(() => {});
      }
    };
  }, [threadId]);
}
