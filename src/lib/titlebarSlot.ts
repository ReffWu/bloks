// Where a conversation's tabs go on a desktop: up in the title bar, in the
// row the window's own buttons sit in, the way Claude, browsers and many
// Mac apps use that strip. TitleBar.tsx leaves an empty slot; the chat
// renders its tabs into it with a portal. On a phone-narrow window the
// title bar is not drawn, so this answers null and the tabs stay under
// the header, where they were.
import { useEffect, useState, useSyncExternalStore } from "react";

export const TITLEBAR_TABS_ID = "titlebar-tabs";
const WIDE = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useTitlebarSlot(): HTMLElement | null {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(wide ? document.getElementById(TITLEBAR_TABS_ID) : null);
  }, [wide]);
  return slot;
}
