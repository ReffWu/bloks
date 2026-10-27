// The cards a failure leaves in a conversation (server/incidents.ts).
//
// An incident put to the person reads as one thing that needs them, not as
// an error: what failed, why, and what the lead asked for when one looked
// at it, with the two things worth doing about it right here. Calm on
// purpose. The red and the warning triangle are for something that went
// wrong just now and is still going wrong; this is something that went
// wrong, was looked at, and is waiting for a decision.
//
// A routine or a watcher that stopped for failing gets the same shape with
// its own three choices: fix it (Automations, opened on it), pause it, or
// remove it. Each is the ordinary route the rest of the app uses, so the
// card is a shortcut and never a second way to change anything.
import { useState } from "react";
import { Check, Hand, RotateCw } from "@/components/icons";
import { api, useStore, type Message } from "@/state/store";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** The frame both cards share: the shape of a goal's card, with a quiet
 * label over the words. */
function Card({
  fresh,
  settled,
  label,
  children,
  actions,
}: {
  fresh?: boolean;
  settled?: boolean;
  label: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("flex justify-start", fresh && "animate-receive-in")}>
      <div className={cn("flex max-w-[560px] flex-col gap-1.5 rounded-2xl border bg-card px-3.5 py-2.5", settled && "opacity-80")}>
        <div className="flex items-center gap-1.5 text-caption font-medium">{label}</div>
        <div className="whitespace-pre-wrap text-ui leading-relaxed text-foreground">{children}</div>
        {actions && <div className="mt-0.5 flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

/** A needs-you card, or the one card while the desk is quiet. */
export function IncidentNotice({ message, fresh }: { message: Message; fresh?: boolean }) {
  const { dispatch } = useStore();
  const [busy, setBusy] = useState<"retry" | "resolve" | null>(null);
  const mark = message.incident!;
  const settled = mark.state === "resolved";

  const act = (what: "retry" | "resolve") => {
    setBusy(what);
    api(`/api/incidents/${mark.id}/${what}`, { method: "POST" })
      .then((r: { note?: string }) => {
        if (what === "retry") toast(r.note ?? t("incidentCard.tryingItAgain"));
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(null));
  };

  if (mark.kind === "summary") {
    return (
      <Card
        fresh={fresh}
        label={<span className="text-warning">{t("incidentCard.severalThingsFailed")}</span>}
        actions={
          <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "openPage", page: "overview" })}>
            {t("incidentCard.seeThemInActivity")}
          </Button>
        }
      >
        {message.text}
      </Card>
    );
  }

  return (
    <Card
      fresh={fresh}
      settled={settled}
      label={
        settled ? (
          <span className="flex items-center gap-1 text-success">
            <Check size={12} aria-hidden /> {t("incidentCard.resolved")}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-warning">
            <Hand size={12} aria-hidden /> {t("incidentCard.needsYou")}
          </span>
        )
      }
      actions={
        settled ? (
          mark.resolution ? <span className="text-small text-muted-foreground">{mark.resolution}</span> : undefined
        ) : (
          <>
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => act("retry")}>
              <RotateCw size={12} /> {busy === "retry" ? t("incidentCard.tryingAgain") : t("common.tryAgain")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act("resolve")}>
              {t("incidentCard.markResolved")}
            </Button>
          </>
        )
      }
    >
      {message.text}
    </Card>
  );
}

/** A routine or a watcher that stopped running on its own. */
export function FailingNotice({ message, fresh }: { message: Message; fresh?: boolean }) {
  const { dispatch } = useStore();
  const what = message.failing!;
  // What was done here, so the card says it rather than offering it again.
  // The routine or watcher itself is the record; this is only the card.
  const [done, setDone] = useState<"paused" | "removed" | null>(null);
  const [busy, setBusy] = useState(false);
  const route = what.kind === "routine" ? `/api/routines/${what.id}` : `/api/watchers/${what.id}`;

  const pause = () => {
    setBusy(true);
    api(route, { method: "PATCH", body: JSON.stringify({ enabled: false }) })
      .then(() => setDone("paused"))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };
  const remove = async () => {
    const yes = await confirm({
      title: t("incidentCard.removeTitle", { name: what.name }),
      body: what.kind === "routine" ? t("incidentCard.removeRoutineBody") : t("incidentCard.removeWatcherBody"),
      confirmLabel: t("common.remove"),
      destructive: true,
    });
    if (!yes) return;
    setBusy(true);
    api(route, { method: "DELETE" })
      .then(() => setDone("removed"))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Card
      fresh={fresh}
      settled={done !== null}
      label={
        done ? (
          <span className="text-muted-foreground">{done === "paused" ? t("common.paused") : t("incidentCard.removed")}</span>
        ) : (
          <span className="flex items-center gap-1 text-warning">
            <Hand size={12} aria-hidden /> {t("incidentCard.needsYou")}
          </span>
        )
      }
      actions={
        done ? undefined : (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => dispatch({ type: "toggleRoutines", open: true, tab: what.kind === "routine" ? "schedules" : "watchers", focus: { kind: what.kind, id: what.id } })}
            >
              {t("incidentCard.fixIt")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={pause}>
              {t("common.pause")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              {t("common.remove")}
            </Button>
          </>
        )
      }
    >
      {message.text}
    </Card>
  );
}
