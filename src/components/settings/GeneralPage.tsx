// Settings, General: what you are called, how Bloks looks, and the one
// shortcut that reaches it from anywhere.
//
// The person's own page, so it holds only what is theirs: their name,
// the theme (which follows them into every workspace), the accent, how
// wide a chat reads, and the system-wide hotkey. How agents behave has a
// page of its own (settings/BehaviourPage.tsx).
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "@/components/icons";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useTheme, type Theme } from "@/lib/theme";
import { useTranscriptWidth } from "@/lib/useTranscriptWidth";
import { useConversationsView } from "@/lib/conversationsView";
import { useWorkspaces } from "@/lib/workspaces";
import { setSameAccent } from "@/lib/accent";
import { thisComputer } from "@/lib/thisComputer";
import { cn } from "@/lib/cn";
import { AccentPicker } from "../AccentPicker";
import { SettingRow, SettingsGroup } from "../SettingsLayout";
import { YourName } from "./YourName";

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "System", icon: <Monitor size={14} /> },
];

/**
 * The system-wide hotkey, and the honest reporting around it.
 *
 * Off until somebody sets one: a global shortcut that arrives uninvited
 * will sooner or later collide with something they already use. And
 * because another app may already own the keys, registration answers
 * with what actually took rather than assuming it worked.
 */
function QuickAskShortcut() {
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAccelerator(c.shortcuts?.quickAsk ?? null))
      .catch(() => {});
  }, []);

  const save = async (next: string | null) => {
    setProblem(null);
    const took = (await window.bloks?.shortcutApply(next)) ?? null;
    if (next && !took) {
      setProblem("Another app uses those keys. Try another combination.");
      return;
    }
    setAccelerator(took);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: { quickAsk: took } }),
    }).catch(() => {});
  };

  // Reading a chord off a keypress, in Electron's own spelling.
  const capture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === "Escape") return setCapturing(false);
    // a modifier on its own is not a shortcut, it is half of one
    if (["Shift", "Control", "Alt", "Meta"].includes(key)) return;
    const parts: string[] = [];
    if (e.metaKey) parts.push("Command");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (parts.length === 0) {
      setProblem("Include a modifier key, like Command or Control.");
      return;
    }
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    setCapturing(false);
    void save(parts.join("+"));
  };

  if (!window.bloks) return null;

  return (
    <SettingRow
      label="Quick ask shortcut"
      info="Tab picks a different agent, Enter sends, Escape closes."
      description={`Ask any agent from anywhere on ${thisComputer()}.`}
      error={problem}
      control={
        <div className="flex items-center gap-1.5">
          {accelerator && !capturing && (
            <button
              onClick={() => void save(null)}
              className="rounded-lg px-2 py-1 text-body text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => {
              setProblem(null);
              setCapturing(true);
            }}
            onKeyDown={capturing ? capture : undefined}
            onBlur={() => setCapturing(false)}
            className={cn(
              "min-w-[132px] rounded-lg border px-3 py-1.5 text-body font-medium tabular-nums transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.96]",
              capturing
                ? "border-brand bg-brand-soft text-foreground"
                : "border-input text-foreground hover:border-foreground/25",
            )}
          >
            {capturing ? "Press the keys…" : (accelerator ?? "Not set")}
          </button>
        </div>
      }
    />
  );
}

export function GeneralPage() {
  const { theme, setTheme } = useTheme();
  const workspaces = useWorkspaces();
  const [width, setWidth] = useTranscriptWidth();
  const [conversations, setConversations] = useConversationsView();
  const shared = Boolean(window.bloks?.workspace && workspaces.available && workspaces.sameAccent);
  return (
    <>
      <SettingsGroup title="You">
        <YourName />
      </SettingsGroup>
      <SettingsGroup title="Appearance">
        <SettingRow
          label="Theme"
          description="Follows you into every workspace."
          control={
            <Segmented
              aria-label="Theme"
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS.map((o) => ({ value: o.value, label: <>{o.icon}{o.label}</> }))}
            />
          }
        />
        <SettingRow
          label="Accent"
          description={
            !window.bloks?.workspace
              ? "Your messages, the main buttons and what is selected."
              : shared
                ? "Your messages, the main buttons and what is selected, in every workspace."
                : "Your messages, the main buttons and what is selected, in this workspace."
          }
          control={<AccentPicker />}
        />
        {/* only where there are workspaces to share it between */}
        {window.bloks?.workspace && workspaces.available && window.bloks.prefsSameAccent && (
          <SettingRow
            label="Same accent in every workspace"
            description="Off, each workspace keeps its own."
            control={
              <Switch
                aria-label="Same accent in every workspace"
                checked={Boolean(workspaces.sameAccent)}
                onCheckedChange={(on) => void setSameAccent(on)}
              />
            }
          />
        )}
        <SettingRow
          label="Transcript width"
          description="How wide chats read on this device."
          control={
            <Segmented
              aria-label="Transcript width"
              value={width}
              onChange={setWidth}
              options={[
                { value: "narrow", label: "Narrow" },
                { value: "medium", label: "Medium" },
                { value: "wide", label: "Wide" },
              ]}
            />
          }
        />
        <SettingRow
          label="Show conversations in the sidebar"
          description="List each agent's conversations under it."
          control={<Switch aria-label="Show conversations in the sidebar" checked={conversations} onCheckedChange={setConversations} />}
        />
        {/* the app says whether there is one: only on a Mac */}
        {window.bloks?.prefsNotch && workspaces.available && typeof workspaces.notch === "boolean" && (
          <SettingRow
            label="Show working agents in the notch"
            description="Who is at work, at the top of the screen. Point at it for what each one is doing."
            control={
              <Switch
                aria-label="Show working agents in the notch"
                checked={workspaces.notch}
                onCheckedChange={(on) => void window.bloks?.prefsNotch?.(on)}
              />
            }
          />
        )}
      </SettingsGroup>
      {window.bloks && (
        <SettingsGroup title="Shortcut">
          <QuickAskShortcut />
        </SettingsGroup>
      )}
    </>
  );
}
