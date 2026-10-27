// The Bloks browser beside the chat, and the Mac's browser seen from
// anywhere else.
//
// In the desktop app the page itself is not drawn here. Each tab is a
// view the app lays over the window (electron/app-browser.mjs), so this
// panel draws everything around it, the tabs, the address bar, who has
// the wheel, the downloads, and keeps one empty box where the page goes,
// telling the app where that box is whenever it moves. A native view sits
// above the page, so while a dialog or a menu is open the box is said to
// be off screen, and the tab hides until it closes.
//
// Elsewhere (a phone, the web app) there is no browser, only news of the
// Mac's: a strip in the agent's conversation, with a small live picture
// when the Mac can send one.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FolderOpen,
  Globe,
  Hand,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AgentAvatar } from "@/components/Avatar";
import { HeaderButton } from "@/components/terminal/TerminalMenus";
import { platformOf } from "@/lib/shortcuts";
import {
  BROWSER_SIDE_BY_SIDE,
  browsingFor,
  clampBrowserWidth,
  controlLine,
  downloadSize,
  hasOwnBrowser,
  hostLabel,
  isSecure,
  noteBrowserState,
  setBrowserPanel,
  shownAddress,
  tabLabel,
  useAppBrowser,
  useBrowserPanel,
  type AppBrowserState,
  type BrowserDo,
  type BrowserTab,
} from "@/lib/appBrowser";
import { t } from "@/lib/i18n";

/** The server's word on the Mac's browser, for a page that is not on it;
 * its "browser.app" frames keep it fresh after this. */
const loadFromServer = () => api("/api/browser").then((said: { state?: unknown }) => noteBrowserState(said?.state ?? null));

/** The browser's state, wherever this page is. */
export function useBrowserState(): AppBrowserState | null {
  return useAppBrowser(loadFromServer);
}

const act = (action: BrowserDo, arg?: string) =>
  (window.bloks?.browserDo?.(action, arg) ?? Promise.resolve(null)).then(
    (answer) => {
      if (answer?.error) toast.error(answer.error);
      return answer;
    },
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    },
  );

/** The app asking for the panel because an agent started browsing: the
 * person watches it happen rather than finding out after. */
export function useBrowserReveal() {
  useEffect(() => {
    if (!window.bloks?.onBrowserReveal) return;
    return window.bloks.onBrowserReveal(() => setBrowserPanel({ open: true }));
  }, []);
}

/** Something drawn over the page (a dialog, a menu, the palette), which a
 * native view would otherwise cover. */
const OVER_THE_PAGE = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';

function useSomethingOver(panel: HTMLElement | null): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const found = [...document.querySelectorAll(OVER_THE_PAGE)].some((el) => !panel?.contains(el));
      setOver((was) => (was === found ? was : found));
    };
    check();
    // at most once a frame: a streaming reply changes the page constantly
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-state"] });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [panel]);
  return over;
}

/**
 * The panel, docked on the chat's right, or over the chat when the window
 * is too narrow for both. Drawn only in the desktop app.
 */
export function BrowserDock({ botNames }: { botNames?: Record<string, string> }) {
  const { open, width } = useBrowserPanel();
  const [room, setRoom] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [holder, setHolder] = useState<HTMLDivElement | null>(null);

  // the room the chat and the panel share, measured on the row they share
  useLayoutEffect(() => {
    const row = holder?.parentElement;
    if (!row) return;
    const measure = () => setRoom(row.getBoundingClientRect().width);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [holder]);

  if (!open || !hasOwnBrowser()) return null;
  const narrow = room > 0 && room < BROWSER_SIDE_BY_SIDE;
  const shown = narrow ? room : clampBrowserWidth(dragging ?? width, room || window.innerWidth);
  return (
    <>
      {!narrow && (
        <Edge
          width={shown}
          room={room}
          onDrag={setDragging}
          onDone={(next) => {
            setDragging(null);
            setBrowserPanel({ width: next });
          }}
        />
      )}
      <div
        ref={setHolder}
        className={cn("flex min-h-0 min-w-0 shrink-0 flex-col border-l bg-card", narrow && "absolute inset-0 z-30 border-l-0")}
        style={narrow ? undefined : { width: shown }}
      >
        <BrowserPanel resizing={dragging !== null} botNames={botNames} />
      </div>
    </>
  );
}

/** The edge between the chat and the panel: drag it, or focus it and use
 * the arrow keys (Shift for bigger steps). */
function Edge({ width, room, onDrag, onDone }: { width: number; room: number; onDrag: (w: number) => void; onDone: (w: number) => void }) {
  const clamp = (w: number) => clampBrowserWidth(w, room || window.innerWidth);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("browserPanel.resizeTheBrowser")}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        const start = e.clientX;
        let last = width;
        const move = (event: PointerEvent) => {
          last = clamp(width + (start - event.clientX));
          onDrag(last);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          onDone(last);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? 1 : -1);
        onDone(clamp(width + step));
      }}
      className="w-1.5 shrink-0 cursor-ew-resize bg-transparent outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent"
    />
  );
}

function BrowserPanel({ resizing, botNames }: { resizing: boolean; botNames?: Record<string, string> }) {
  const state = useBrowserState();
  const { state: store } = useStore();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const over = useSomethingOver(root);
  const [shelf, setShelf] = useState(false);
  const active = state?.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const line = controlLine(state?.control);

  // Where the page goes, said to the app whenever it moves, and "nowhere"
  // while something is drawn over it, while the edge is dragged (the view
  // would lag the drag a frame behind) and once the panel is gone.
  const report = useCallback(() => {
    const box = page.current?.getBoundingClientRect();
    const hidden = !box || over || resizing || document.visibilityState === "hidden";
    void window.bloks?.browserBounds?.(hidden ? null : { x: box.left, y: box.top, width: box.width, height: box.height });
  }, [over, resizing]);
  useLayoutEffect(() => {
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    soon();
    const watch = new ResizeObserver(soon);
    if (page.current) watch.observe(page.current);
    window.addEventListener("resize", soon);
    document.addEventListener("visibilitychange", soon);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      window.removeEventListener("resize", soon);
      document.removeEventListener("visibilitychange", soon);
    };
  }, [report, state?.activeTabId, shelf, line?.text]);
  useEffect(() => () => void window.bloks?.browserBounds?.(null), []);

  // a download starting opens the shelf, so it is seen arriving
  const newest = state?.downloads[0]?.id;
  const seenNewest = useRef(newest);
  useEffect(() => {
    if (newest && newest !== seenNewest.current) setShelf(true);
    seenNewest.current = newest;
  }, [newest]);

  const close = () => setBrowserPanel({ open: false });
  const tabs = state?.tabs ?? [];
  const nameOf = (botId: string, fallback: string) => botNames?.[botId] ?? fallback;

  return (
    <div ref={setRoot} role="region" aria-label={t("browserPanel.bloksBrowser")} className="flex h-full min-h-0 w-full min-w-0 flex-col bg-card">
      <div className="flex h-[38px] shrink-0 items-center gap-1 px-1.5">
        <Tabs tabs={tabs} activeId={state?.activeTabId ?? null} faces={store.bots} nameOf={nameOf} />
        <HeaderButton label={t("browserPanel.newTab")} onClick={() => void act("newTab")}>
          <Plus size={16} />
        </HeaderButton>
        <div className="min-w-2 flex-1 self-stretch" />
        <HeaderButton label={t("browserPanel.hideTheBrowserItsTabs")} onClick={close}>
          <X size={16} />
        </HeaderButton>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t px-1.5 py-1.5">
        <HeaderButton label={t("common.back")} disabled={!active?.canGoBack} onClick={() => void act("back")}>
          <ArrowLeft size={15} />
        </HeaderButton>
        <HeaderButton label={t("browserPanel.forward")} disabled={!active?.canGoForward} onClick={() => void act("forward")}>
          <ArrowRight size={15} />
        </HeaderButton>
        <HeaderButton label={active?.loading ? t("browserPanel.stopLoading") : t("browserPanel.reload")} disabled={!active} onClick={() => void act(active?.loading ? "stop" : "reload")}>
          {active?.loading ? <X size={15} /> : <RotateCw size={15} />}
        </HeaderButton>
        <AddressBar key={active?.id ?? "none"} tab={active} />
        <HeaderButton label={t("browserPanel.openThisPageInYour")} disabled={!hostLabel(active?.url)} onClick={() => void act("openExternal")}>
          <ExternalLink size={15} />
        </HeaderButton>
        <HeaderButton label={t("browserPanel.downloads")} pressed={shelf} onClick={() => setShelf((s) => !s)} className="relative">
          <Download size={15} />
          {state?.downloads.some((d) => d.state === "progressing") && (
            <span aria-hidden className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-brand" />
          )}
        </HeaderButton>
      </div>

      {line && (
        <div
          role="status"
          className={cn(
            "flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-small",
            line.tone === "agent" ? "bg-brand-soft text-foreground" : "bg-muted text-foreground",
          )}
        >
          {line.tone === "agent" ? (
            <span aria-hidden className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand" />
            </span>
          ) : (
            <Hand size={13} className="shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{line.text}</span>
          <Button size="sm" variant={line.action === "takeOver" ? "secondary" : "brand"} className="h-6 shrink-0 px-2.5 text-small" onClick={() => void act(line.action)}>
            {line.action === "takeOver" ? t("browserPanel.takeOver") : t("browserPanel.giveBack")}
          </Button>
        </div>
      )}

      {/* where the app puts the page; what shows here is only ever seen
          when there is no page, or something is drawn over it */}
      <div ref={page} className="relative min-h-0 flex-1 border-t bg-background">
        {!active ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
            <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Globe size={18} />
            </div>
            <p className="text-ui font-medium text-foreground">{t("browserPanel.nothingOpenYet")}</p>
            <p className="max-w-[40ch] text-pretty text-body text-muted-foreground">
              {t("browserPanel.typeAnAddressAboveOr")}
            </p>
          </div>
        ) : over ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-small text-muted-foreground">
            {t("browserPanel.thePageIsHiddenWhile")}
          </div>
        ) : null}
      </div>

      {shelf && <Shelf downloads={state?.downloads ?? []} onClose={() => setShelf(false)} />}
    </div>
  );
}

function Tabs({
  tabs,
  activeId,
  faces,
  nameOf,
}: {
  tabs: BrowserTab[];
  activeId: string | null;
  faces: ReturnType<typeof useStore>["state"]["bots"];
  nameOf: (botId: string, fallback: string) => string;
}) {
  const ids = tabs.map((t) => t.id);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = activeId ? ids.indexOf(activeId) : -1;
    const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!by || at < 0 || ids.length < 2) return;
    e.preventDefault();
    const next = ids[(at + by + ids.length) % ids.length];
    void act("selectTab", next);
    document.getElementById(`browser-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={t("browserPanel.browserTabs")} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const open = tab.id === activeId;
        const label = tabLabel(tab);
        const agent = tab.by.kind === "agent" ? tab.by : null;
        const face = agent ? faces.find((b) => b.id === agent.botId) : null;
        const driver = agent ? nameOf(agent.botId, agent.name) : null;
        return (
          <div key={tab.id} className="group relative flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              id={`browser-tab-${tab.id}`}
              aria-selected={open}
              tabIndex={open ? 0 : -1}
              onClick={() => void act("selectTab", tab.id)}
              title={`${label}${driver ? `\nDriven by ${driver}` : ""}\n${tab.url}`}
              className={cn(
                "flex h-7 max-w-[184px] items-center gap-1.5 rounded-md pl-2 pr-7 text-body outline-none transition-colors duration-150",
                open ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {tab.loading ? (
                <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
              ) : face ? (
                <AgentAvatar bot={face} size={15} className="shrink-0" />
              ) : (
                <Globe size={13} className="shrink-0" aria-hidden />
              )}
              <span className="truncate">{label}</span>
              {driver && <span className="sr-only">, driven by {driver}</span>}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Close ${label}`}
              title={`Close ${label}`}
              onClick={() => void act("closeTab", tab.id)}
              className={cn(
                "absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground transition-[opacity,background-color,color] duration-150 hover:bg-foreground/10 hover:text-foreground",
                open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The address bar: the page's address until you type, then yours. */
function AddressBar({ tab }: { tab: BrowserTab | null }) {
  const [typed, setTyped] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const shown = typed ?? shownAddress(tab?.url);
  // a new, blank tab is somewhere to type
  useEffect(() => {
    if (tab && !shownAddress(tab.url)) field.current?.focus();
  }, [tab?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form
      className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2 transition-[border-color] duration-150 focus-within:border-ring/60 hover:border-foreground/25"
      onSubmit={(e) => {
        e.preventDefault();
        const text = (typed ?? "").trim();
        if (!text) return;
        void act("navigate", text).then((answer) => {
          if (answer && !answer.error) {
            setTyped(null);
            field.current?.blur();
          }
        });
      }}
    >
      {isSecure(tab?.url) && typed === null ? (
        <Lock size={12} className="shrink-0 text-muted-foreground" aria-label={t("browserPanel.secureConnection")} />
      ) : (
        <Globe size={12} className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      <input
        ref={field}
        value={shown}
        onChange={(e) => setTyped(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setTyped(null);
            e.currentTarget.blur();
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={t("browserPanel.searchOrTypeAnAddress")}
        aria-label={t("common.address")}
        className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}

function Shelf({ downloads, onClose }: { downloads: AppBrowserState["downloads"]; onClose: () => void }) {
  return (
    <section aria-label={t("browserPanel.downloads")} className="max-h-[40%] shrink-0 overflow-y-auto border-t bg-card px-2 pb-2 pt-1.5">
      <div className="flex items-center gap-1 px-1 pb-1.5">
        <h2 className="flex-1 text-small font-medium text-muted-foreground">{t("browserPanel.downloads")}</h2>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-small" onClick={() => void act("openDownloads")}>
          <FolderOpen size={13} /> {t("browserPanel.folder")}
        </Button>
        {downloads.some((d) => d.state !== "progressing") && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-small" onClick={() => void act("clearDownloads")}>
            {t("common.clear")}
          </Button>
        )}
        <HeaderButton label={t("browserPanel.hideDownloads")} onClick={onClose} className="size-6">
          <X size={13} />
        </HeaderButton>
      </div>
      {downloads.length === 0 ? (
        <p className="px-1 pb-1 text-small text-muted-foreground">{t("browserPanel.filesYouOrAnAgent")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {downloads.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 rounded-xl border bg-background px-2.5 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {d.state === "progressing" ? <Loader2 size={15} className="animate-spin" /> : <FileIcon size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground" title={d.name}>
                  {d.name}
                </p>
                <p className={cn("truncate text-small", d.state === "interrupted" ? "text-destructive" : "text-muted-foreground")}>
                  {downloadSize(d)}
                  {d.by ? ` · by ${d.by}` : ""}
                </p>
              </div>
              {d.state === "completed" && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-small" onClick={() => void act("openDownload", d.id)}>
                    {t("common.open")}
                  </Button>
                  <HeaderButton label={platformOf() === "mac" ? t("browserPanel.showInFinder") : t("browserPanel.showInFolder")} onClick={() => void act("revealDownload", d.id)} className="size-6">
                    <FolderOpen size={13} />
                  </HeaderButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── anywhere but the Mac ───────────────────────────────────────────────

/**
 * In an agent's conversation on a phone or the web app: the agent is
 * browsing on the Mac, or waiting there for the person to give the
 * browser back. A small picture of the page while it is looked at, when
 * the Mac can send one; just the words when it cannot.
 */
export function BrowsingOnMac({ botId, name }: { botId: string; name: string }) {
  const state = useBrowserState();
  const doing = hasOwnBrowser() ? null : browsingFor(state, botId);
  const [frame, setFrame] = useState<string | null>(null);
  const active = state?.tabs.find((t) => t.id === state.activeTabId);

  useEffect(() => {
    if (!doing) {
      setFrame(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      if (document.visibilityState === "visible") {
        api("/api/browser/frame")
          .then((said: { live?: boolean; jpeg?: string }) => !stopped && setFrame(said?.live && said.jpeg ? said.jpeg : null))
          .catch(() => !stopped && setFrame(null));
      }
      timer = setTimeout(look, 2000);
    };
    look();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [doing]);

  if (!doing) return null;
  const where = active ? tabLabel(active) : null;
  return (
    <div className="mx-auto w-full max-w-[var(--transcript-width,760px)] px-4 pb-2 md:px-6">
      <div role="status" className="flex animate-rise-in items-center gap-3 rounded-2xl border bg-card p-2.5 shadow-[0_1px_3px_var(--shadow-color)]">
        <Thumb jpeg={frame} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-ui font-medium text-foreground">
            {doing === "driving" && (
              <span aria-hidden className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
            )}
            Browsing on the Mac
          </p>
          <p className="truncate text-small text-muted-foreground">
            {doing === "driving" ? `${name}${where ? ` is on ${where}` : " is using the Bloks browser"}` : `You took over on the Mac. ${name} waits for it back.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function Thumb({ jpeg }: { jpeg: string | null }): ReactNode {
  if (!jpeg) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Globe size={18} />
      </span>
    );
  }
  return <img src={`data:image/jpeg;base64,${jpeg}`} alt={t("browserPanel.thePageOnTheMac")} className="h-12 w-20 shrink-0 rounded-lg border object-cover object-top" />;
}
