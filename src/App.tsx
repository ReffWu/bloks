import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "@/components/icons";
import { StoreProvider, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Onboarding } from "@/components/Onboarding";
import { Intro, introPending } from "@/components/Intro";
import { initAnalytics, setupDone, workspaceSetupDone } from "@/lib/analytics";
import { unreadCount } from "@/lib/unread";
import { Sidebar } from "@/components/Sidebar";
import { AppRail } from "@/components/AppRail";
import { RailPageView } from "@/components/RailPages";
import { TitleBar } from "@/components/TitleBar";
import { MobileNav } from "@/components/MobileNav";
import { ChatView } from "@/components/ChatView";
import { NewAgentScreen } from "@/components/NewAgentScreen";
import { AgentSettingsPage } from "@/components/SettingsPanel";
import { RoomView } from "@/components/RoomView";
import { NewRoomDialog } from "@/components/NewRoomDialog";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutKeys } from "@/components/Shortcuts";
import { Switcher } from "@/components/Switcher";
import { QuickAsk } from "@/components/QuickAsk";
import { Toaster, toast } from "@/components/ui/toast";
import { ConfirmHost } from "@/components/ui/confirm";
import { TerminalWindow, terminalWindowAgent } from "@/components/terminal/TerminalWindow";

/**
 * Whatever went wrong, said over every view as an error toast. It used to
 * be drawn by the chat alone, so a room send, an engine connect in
 * Settings or a room rename that failed said nothing at all while a room
 * or Settings was open.
 *
 * Each error is its own toast, so a second failure no longer pushes the
 * first off the screen before it was read; the same words again only
 * restart the one already showing. The store keeps the error until its
 * toast goes, and the clear names that error (errorAt), so an older
 * toast leaving cannot take a newer error with it.
 */
function ErrorToasts() {
  const { state, dispatch } = useStore();
  const { error, errorAt } = state;
  useEffect(() => {
    if (!error) return;
    toast.error(error, {
      id: `error:${error}`,
      onDismiss: () => dispatch({ type: "error", message: null, at: errorAt }),
    });
  }, [error, errorAt, dispatch]);
  return null;
}

/**
 * The work panel's content, under a key that changes only when the place
 * does (a rail page, Settings, Automations, a room, the chat), so moving
 * between places fades the new one in over 150ms instead of cutting to
 * it. Opacity only: nothing moves, and the page takes clicks from its
 * first frame, so the fade never costs a wait.
 *
 * Not every change is a move worth marking. Picking another agent keeps
 * the key, so the chat does not blink on every pick; a move close on the
 * heels of the last one, which is somebody stepping through places from
 * the keyboard, lands at once; and reduce motion means no fade at all.
 */
function PlaceFade({ place, children }: { place: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const last = useRef({ place, at: 0, fade: false });
  if (last.current.place !== place) {
    const now = performance.now();
    last.current = { place, at: now, fade: now - last.current.at > 350 };
  }
  const fade = last.current.fade && !reduce;
  return (
    <motion.div
      key={place}
      initial={fade ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col md:flex-row"
    >
      {children}
    </motion.div>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  const room = state.bloks.find((b) => b.id === state.selectedId);
  const bot = room
    ? null
    : (state.bots.find((b) => b.id === state.selectedId && !b.hidden) ??
      state.bots.find((b) => !b.hidden) ??
      null);

  // The Dock badge mirrors the sidebar's unread dots. Absent bridge
  // means a browser tab, which has no Dock to speak of.
  const waiting = unreadCount(state.bots);
  useEffect(() => {
    window.bloks?.badgeSet?.(waiting);
  }, [waiting]);
  // The main rail is always there (beside a phone-narrow window's header
  // there is no room for it, and that header carries the same doors);
  // the chat's own sidebar only while Chat is the place.
  // An agent's settings are a page like the others, in the panel where
  // its chat was, so they have the panel to themselves.
  const agentSettings = state.settingsOpen && bot !== null && !room;
  const chatPlace = !state.appSettingsOpen && !state.routinesOpen && !state.page && !agentSettings;
  const place = state.appSettingsOpen
    ? "settings"
    : state.routinesOpen
      ? "automations"
      : state.page
        ? `page:${state.page}`
        : agentSettings
          ? "agent-settings"
          : room
            ? "room"
            : "chat";
  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-sidebar">
      <TitleBar />
      <MobileNav />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <div className="hidden h-full md:flex">
        <AppRail />
      </div>
      {/* Everything beside the rail sits on one panel, set in from the
          window's top with a rounded corner, so the rail reads as the
          frame and the panel as the work. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:flex-row md:rounded-tl-xl md:border-l md:border-t">
      {chatPlace ? <Sidebar /> : <div className="md:hidden"><Sidebar /></div>}
      <PlaceFade place={place}>
      {state.appSettingsOpen ? (
        <AppSettingsPanel />
      ) : state.routinesOpen ? (
        <AutomationsPanel onClose={() => dispatch({ type: "toggleRoutines", open: false })} />
      ) : state.page ? (
        <RailPageView page={state.page} />
      ) : agentSettings && bot ? (
        <AgentSettingsPage key={bot.id} bot={bot} />
      ) : room ? (
        <RoomView key={room.id} blok={room} />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          {state.connected && state.hydrated ? (
            // loaded, and truly empty: the next step, not a spinner that
            // never stops
            <>
              <div className="text-lead font-medium text-foreground">No agents yet</div>
              <div className="max-w-[300px] text-center text-body leading-relaxed">
                An agent has a job, like researcher or writer. Make your first one.
              </div>
              <Button onClick={() => dispatch({ type: "toggleNewAgent", open: true })}>New agent</Button>
            </>
          ) : (
            <>
              <Loader2 size={20} className="animate-spin" />
              <div className="text-ui">{state.connected ? "Loading your agents…" : "Connecting to Bloks…"}</div>
              {/* a developer hint; someone who installed the app has no
                  command to run and should not be told one */}
              {!state.connected && import.meta.env.DEV && (
                <div className="text-small">
                  Start it with <code className="rounded bg-muted px-1.5 py-0.5">pnpm dev:server</code>
                </div>
              )}
            </>
          )}
        </main>
      )}
      </PlaceFade>
      {/* In the panel's row, to the right of the work. Left outside it,
          as a child of the window's column, it took the full height and
          squeezed the chat and the sidebar to nothing. */}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      </div>
      </div>
      {state.newRoomOpen && <NewRoomDialog />}
      {state.newAgentOpen && <NewAgentScreen />}
      <CommandPalette />
      <ShortcutKeys />
      <ErrorToasts />
      {/* what is on screen, for Ctrl+Tab to come back to: a room, or one
          of an agent's conversations */}
      <Switcher
        shown={room ? { id: room.id } : bot ? { id: bot.id, lane: bot.activeTaskId ?? bot.threadId } : null}
      />
    </div>
  );
}

export default function App() {
  // The panel window loads the same bundle with a flag. It shares nothing
  // else with the workspace: no store, no stream, no intro, because it is
  // open for four seconds at a time.
  if (new URLSearchParams(location.search).has("quick")) return <QuickAsk />;
  // So does an agent's terminal popped out into a window of its own.
  const terminalFor = terminalWindowAgent(location.search);
  if (terminalFor) return <TerminalWindow botId={terminalFor} />;

  // First launch runs the cinematic intro, then the working onboarding.
  // Two separate flags on purpose: someone who skips the intro still needs
  // setup, and someone who resets setup should not sit through the film
  // twice.
  const forced = new URLSearchParams(location.search).has("intro");
  const [introOpen, setIntroOpen] = useState(
    // never replay the film for a workspace that finished setup before the
    // intro existed; ?intro forces a showing for design review
    () => (introPending() && !setupDone()) || forced,
  );
  const [setupOpen, setSetupOpen] = useState(() => !setupDone());
  // Until the workspace answers, showing the dashboard would be a guess,
  // and a wrong guess flashes the whole app for a moment before the
  // welcome covers it. A workspace that has clearly never been set up
  // needs no wait; everyone else holds on the app's own background for
  // the few milliseconds a loopback request takes.
  const [settled, setSettled] = useState(() => introPending() && !setupDone());
  useEffect(() => {
    initAnalytics();
    // The browser's flag is only a first guess: it is per origin, and the
    // app's origin moves with its port. The workspace itself is the
    // authority, so correct course as soon as it answers. A workspace that
    // has been set up closes both; one that has not opens them, which is
    // what makes a fresh install reliably show the welcome.
    void workspaceSetupDone()
      .then((done) => {
        if (forced) return;
        setIntroOpen(done ? false : introPending());
        setSetupOpen(!done);
      })
      .finally(() => setSettled(true));
  }, [forced]);
  if (!settled) return <div className="h-full bg-background" />;
  return (
    // Reduce motion on the Mac means reduce it here: movement goes, and
    // the opacity that explains a change stays.
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <Shell />
        {setupOpen && !introOpen && <Onboarding onDone={() => setSetupOpen(false)} />}
        {introOpen && <Intro onDone={() => setIntroOpen(false)} />}
        {/* over everything, the welcome included: a question, or a word
            about what just happened, is never behind what it is about */}
        <ConfirmHost />
        <Toaster />
      </StoreProvider>
    </MotionConfig>
  );
}
