// The paste-a-key rows.
//
// Write-only, in both directions: what is typed goes to the server and
// nothing ever comes back. Reading the config says whether a credential
// exists, never what it is, so a key cannot be recovered from the screen
// that set it.
//
// Saving rebuilds the engines server-side, which is why a pasted key
// works on the next message rather than after a restart.
import { useState } from "react";
import { Check } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { HelpCircle } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { composioKeyMistake } from "@/lib/keyShape";
import { rowKey } from "@/lib/settingsPages";

export type ConfigSection = "composio" | "composioApi" | "box" | "elevenlabs" | "openaiSpeech";

const SECTIONS: Record<
  ConfigSection,
  { body: (value: string) => unknown; flag: (config: ConfigStatus) => boolean }
> = {
  composio: { body: (v) => ({ composio: { key: v } }), flag: (c) => c.composio.configured },
  elevenlabs: {
    body: (v) => ({ speech: { elevenlabsKey: v } }),
    flag: (c) => c.speech?.elevenlabs ?? false,
  },
  openaiSpeech: {
    body: (v) => ({ speech: { openaiKey: v } }),
    flag: (c) => c.speech?.openai ?? false,
  },
  composioApi: {
    body: (v) => ({ composio: { apiKey: v } }),
    flag: (c) => c.composio.apiKeyConfigured ?? false,
  },
  box: { body: (v) => ({ box: { token: v } }), flag: (c) => c.box.configured },
};

/**
 * Saves one key the way every row does: caught at the paste when it is
 * the wrong kind of Composio key, otherwise sent to the server, which
 * checks a Composio key before keeping it. Throws with the reason when it
 * is refused, so whoever asked can say why. The store hears the new
 * status either way it lands, so every screen stops saying it is missing.
 */
export async function saveApiKey(
  section: ConfigSection,
  value: string,
  dispatch: ReturnType<typeof useStore>["dispatch"],
): Promise<boolean> {
  const mistake =
    section === "composio" || section === "composioApi" ? composioKeyMistake(section, value) : null;
  if (mistake) throw new Error(mistake);
  const status: ConfigStatus = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(SECTIONS[section].body(value.trim())),
  });
  dispatch({ type: "configStatus", config: status });
  return SECTIONS[section].flag(status);
}

export function ApiKeyRow({
  section,
  label,
  description,
  placeholder,
  onSaved,
  info,
  bare,
  children,
}: {
  section: ConfigSection;
  label: string;
  /** One line under the label, as a settings row has. */
  description?: string;
  placeholder: string;
  /** Fires once the save lands, with whether that section now has a
   * credential, so the surrounding UI can stop saying it is missing. */
  onSaved?: (configured: boolean) => void;
  /** A small ? beside the label that opens an explainer, with an
   * optional guide link. */
  info?: { text: string; linkLabel?: string; linkHref?: string };
  /** Drawn without a row's own padding, inside a card that has its own. */
  bare?: boolean;
  /** Anything that belongs under the field. */
  children?: React.ReactNode;
}) {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const id = `key-${section}`;

  const configured = state.config ? SECTIONS[section].flag(state.config) : false;
  const clearing = !value.trim() && configured;

  const save = () => {
    if (saving || (!value.trim() && !configured)) return;
    const mistake =
      section === "composio" || section === "composioApi" ? composioKeyMistake(section, value) : null;
    if (mistake) return setError(mistake);
    setSaving(true);
    setError(null);
    saveApiKey(section, value, dispatch)
      .then((nowConfigured) => {
        setValue("");
        onSaved?.(nowConfigured);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  // laid out as a settings row: the name and its state on one line, what
  // it is for under it, and the field across the row's whole width
  return (
    <div data-setting-row={rowKey(label)} className={cn(!bare && "px-5 py-4", "transition-colors duration-700")}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-ui font-medium text-foreground">
          {label}
        </label>
        {info && (
          <button
            type="button"
            onClick={() => setInfoOpen(!infoOpen)}
            aria-expanded={infoOpen}
            className={cn(
              "rounded-full p-0.5 transition-colors",
              infoOpen ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
            )}
            aria-label={`About ${label}`}
          >
            <HelpCircle size={14} />
          </button>
        )}
        <span
          className={cn(
            "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-small font-medium",
            configured ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", configured ? "bg-current" : "border border-current")} />
          {configured ? "Saved" : "Not set"}
        </span>
      </div>
      {description && <div className="mt-0.5 text-pretty text-body text-muted-foreground">{description}</div>}
      {info && infoOpen && (
        <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2.5 text-small leading-relaxed text-muted-foreground">
          {info.text}
          {info.linkHref && (
            <a
              href={info.linkHref}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex w-fit items-center gap-1 rounded font-medium text-brand-ink hover:underline"
            >
              {info.linkLabel ?? "Learn more"}
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
      <div className="mt-2.5 flex gap-2">
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={configured ? "••••••••  (paste to replace)" : placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className="h-8 text-body"
        />
        <Button
          variant={clearing ? "destructive" : "secondary"}
          onClick={save}
          disabled={saving || (!value.trim() && !configured)}
          className="w-[76px]"
          title={clearing ? "Remove saved key" : "Save"}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : clearing ? (
            "Remove"
          ) : (
            <>
              <Check size={13} />
              Save
            </>
          )}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-small text-destructive">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
