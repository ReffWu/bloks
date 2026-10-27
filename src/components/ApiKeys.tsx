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
import { ExternalLink } from "@/components/icons";
import { HelpCircle } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { composioKeyMistake } from "@/lib/keyShape";
import { rowKey } from "@/lib/settingsPages";
import { t } from "@/lib/i18n";

export type ConfigSection = "composio" | "composioApi" | "box" | "elevenlabs" | "openaiSpeech" | "fishSpeech" | "xaiSpeech";

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
  fishSpeech: {
    body: (v) => ({ speech: { fishKey: v } }),
    flag: (c) => c.speech?.fish ?? false,
  },
  // saved means a key of its own: speaking with the Grok engine's key is
  // said under the row, and the field stays open for one of its own
  xaiSpeech: {
    body: (v) => ({ speech: { xaiKey: v } }),
    flag: (c) => c.speech?.xaiSource === "speech",
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
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const id = `key-${section}`;

  const configured = state.config ? SECTIONS[section].flag(state.config) : false;
  // The field is only there when there is something to type: no key yet,
  // or one being replaced. A saved key is a fact, not a form.
  const editing = Boolean(state.config) && (!configured || replacing);
  const typed = value.trim();

  const stopReplacing = () => {
    setReplacing(false);
    setValue("");
    setError(null);
  };

  const save = () => {
    if (busy || !typed) return;
    const mistake =
      section === "composio" || section === "composioApi" ? composioKeyMistake(section, value) : null;
    if (mistake) return setError(mistake);
    setBusy("save");
    setError(null);
    saveApiKey(section, value, dispatch)
      .then((nowConfigured) => {
        setValue("");
        setReplacing(false);
        onSaved?.(nowConfigured);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  // Saving nothing is how the server forgets a key. That is one quiet
  // click away now rather than a field to empty first, so it asks.
  const remove = async () => {
    if (busy) return;
    const yes = await confirm({
      title: `Remove the ${label}?`,
      body: "Bloks forgets it on this computer. You can paste it again any time.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!yes) return;
    setBusy("remove");
    setError(null);
    saveApiKey(section, "", dispatch)
      .then((nowConfigured) => {
        stopReplacing();
        onSaved?.(nowConfigured);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  // laid out as a settings row: the name and its line on the left, how it
  // stands and what can be done on the right, and the field under both
  // only while there is something to type
  return (
    <div data-setting-row={rowKey(label)} className={cn(!bare && "px-5 py-4", "transition-colors duration-700")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex items-center gap-1.5">
            <label htmlFor={editing ? id : undefined} className="text-ui font-medium text-foreground">
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
          </div>
          {description && <div className="mt-0.5 text-pretty text-body text-muted-foreground">{description}</div>}
        </div>
        {configured && (
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <span aria-live="polite" className="mr-2 inline-flex items-center gap-1.5 text-small font-medium text-success">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              Saved
            </span>
            {!replacing && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => setReplacing(true)}
                aria-label={`Replace the ${label}`}
              >
                {t("apiKeys.replace")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void remove()}
              aria-label={`Remove the ${label}`}
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              {busy === "remove" ? <Loader2 size={13} className="animate-spin" /> : t("common.remove")}
            </Button>
          </div>
        )}
      </div>
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
              {info.linkLabel ?? t("apiKeys.learnMore")}
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
      {editing && (
        <div className="mt-3 flex gap-2">
          <Input
            id={id}
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              // Escape keeps the saved key, and leaves Settings open
              if (e.key === "Escape" && replacing) {
                e.preventDefault();
                stopReplacing();
              }
            }}
            placeholder={replacing ? t("apiKeys.pasteTheNewKey") : placeholder}
            autoFocus={replacing}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className="h-8 min-w-0 flex-1 text-body"
          />
          {/* the one action, and it says so only once there is a key to save */}
          <Button variant={typed ? "brand" : "secondary"} onClick={save} disabled={busy !== null || !typed}>
            {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : t("common.save")}
          </Button>
          {replacing && (
            <Button variant="ghost" onClick={stopReplacing} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-small text-destructive">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
