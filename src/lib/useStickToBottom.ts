import { useCallback, useEffect, useState, type RefObject } from "react";

/** How far above the end counts as having left it. A little more than
 * the 80px that still counts as following (useHistoryPaging), so the
 * way back never flickers in and out at the edge of following. */
const AWAY = 160;

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Keeps a conversation at its end while the reader is there.
 *
 * Scrolling to the bottom when a message arrives is not enough: what is
 * already on screen keeps changing size after that scroll, as a font
 * loads, markdown and cards lay out, an image arrives, or the composer
 * below grows or shrinks. Each of those left the last lines under the
 * composer of a conversation that still counted itself as followed, most
 * of all on a phone. So while `pinned` says the reader is at the end, any
 * change of size in the scroller or what is in it takes it back there.
 * Once they scroll up, `pinned` is false and nothing moves under them.
 *
 * It also says when the reader is `away` from the end, for the way back
 * (chat/JumpToLatest.tsx), and `toLatest` is that way back: following
 * again, and a smooth scroll down. From far up the scroll starts a screen
 * or so short of the end, so a long way back is as quick as a short one.
 */
export function useStickToBottom(scrollRef: RefObject<HTMLElement | null>, pinned: RefObject<boolean>) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setAway(el.scrollHeight - el.scrollTop - el.clientHeight > AWAY);
    const stick = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      measure();
    };
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    if (typeof ResizeObserver === "undefined") return () => el.removeEventListener("scroll", measure);
    const sizes = new ResizeObserver(stick);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of Array.from(el.children)) sizes.observe(child);
    };
    watch();
    // what it holds is replaced now and then (an earlier page, a lens)
    const swaps = new MutationObserver(() => {
      watch();
      stick();
    });
    swaps.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
      swaps.disconnect();
    };
  }, [scrollRef, pinned]);

  const toLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    const end = el.scrollHeight - el.clientHeight;
    if (reduced()) {
      el.scrollTop = end;
      return;
    }
    const lead = el.clientHeight * 1.5;
    if (end - el.scrollTop > lead) el.scrollTop = end - lead;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollRef, pinned]);

  return { away, toLatest };
}
