// The secure field an agent plants when a service wants an API key.
//
// The value goes from this input straight to the config file on this
// Mac and reaches the agent's tools as an environment variable on its
// next turn. It never lands in the transcript, never echoes back over
// the API, and the input clears itself the moment the save succeeds.
//
// The same card asks for the token of a Telegram bot the agent made for
// itself. It names the agent and the bot, and the token goes to that
// agent's Telegram settings instead, where pairing then waits.
import { useState } from "react";
import { Check } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { X } from "@/components/icons";
import { type Message, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { t } from "@/lib/i18n";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export function SecretCard({ botId, message }: { botId: string; message: Message }) {
  const { state, dispatch } = useStore();
  const secret = message.secret;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!secret) return null;
  const { label, status } = secret;
  const telegram = secret.telegram;
  const agentName = state.bots.find((bot) => bot.id === botId)?.name ?? t("secretCard.thisAgent");

  const save = () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    api(`/api/bots/${botId}/secret-cards/${message.id}/save`, {
      method: "POST",
      body: JSON.stringify({ value }),
    })
      .then(() => setValue(""))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "w-full max-w-[420px] rounded-2xl border bg-card p-3",
          status === "dismissed" && "opacity-55",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-ui font-semibold text-foreground">
              {telegram ? t("secretCard.connectBot", { bot: telegram.username ?? telegram.bot, agent: agentName }) : label}
            </div>
            {/* a bot's paste instructions are done with once it is connected */}
            {secret.hint && (!telegram || status === "needs-value") && (
              <div className="mt-0.5 text-small text-muted-foreground">{secret.hint}</div>
            )}
          </div>
          {status === "saved" ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-small font-semibold text-success">
              <Check size={13} strokeWidth={3} />
              {telegram ? t("common.connected") : t("common.saved")}
            </span>
          ) : (
            status === "needs-value" && (
              <button
                onClick={() =>
                  void api(`/api/bots/${botId}/secret-cards/${message.id}/dismiss`, {
                    method: "POST",
                  }).catch(() => {})
                }
                title={t("common.dismiss")}
                className="shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <X size={13} />
              </button>
            )
          )}
        </div>

        {status === "needs-value" && (
          <>
            <div className="mt-2.5 flex gap-2">
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder={telegram ? t("common.pasteTheToken") : t("secretCard.pasteYour", { label })}
                autoComplete="off"
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring/60"
              />
              <button
                onClick={save}
                disabled={busy || !value.trim()}
                className="shrink-0 rounded-lg bg-primary px-3 text-body font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : telegram ? t("common.connect") : t("secretCard.saveSecurely")}
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-caption text-muted-foreground/80">
              <ShieldCheck size={11} />
              {t("secretCard.keptOn", { computer: thisComputer() })}
            </div>
            {error && <div className="mt-1 text-small text-destructive">{error}</div>}
          </>
        )}
        {status === "saved" && telegram && (
          <div className="mt-1.5 text-small text-muted-foreground">
            {t("secretCard.pairWith", { bot: telegram.username ?? telegram.bot, agent: agentName })}{" "}
            <button
              onClick={() => {
                dispatch({ type: "select", id: botId });
                dispatch({ type: "toggleSettings", open: true });
              }}
              className="text-foreground underline-offset-2 transition-colors hover:underline"
            >
              {t("secretCard.openSettings")}
            </button>
          </div>
        )}
        {status === "dismissed" && (
          <div className="mt-1 text-small text-muted-foreground">{t("secretCard.dismissed")}</div>
        )}
      </div>
    </div>
  );
}
