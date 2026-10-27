// Where you are, as your iPhone last told this computer (server/location.ts).
//
// The phone is where it is switched on, paused and stopped, so this card
// has no switch of its own: it says whether the phone is sharing, the last
// place and how long ago, which phone said it, and offers Forget, which
// drops what this computer holds. Nothing here asks the phone anything.
import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ThisComputer } from "@/lib/thisComputer";
import { api, useStore } from "@/state/store";
import { ConnectionError, ConnectionHeader, HealthLine, type Health } from "./ConnectionKit";
import { formatDate, t, type MessageKey } from "@/lib/i18n";

type Sharing = "on" | "paused" | "off";

interface Reading {
  place: string;
  precision: "exact" | "area" | "city";
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timeZone?: string;
  observedAt: number;
  device: string;
}

interface LocationState {
  sharing: Sharing;
  location: Reading | null;
  devices: Array<{ id: string; name: string; sharing: Sharing; at: number; background?: boolean }>;
}

const HEALTH: Record<Sharing, { tone: Health; label: MessageKey }> = {
  on: { tone: "on", label: "locationSection.health.sharing" },
  paused: { tone: "wait", label: "common.paused" },
  off: { tone: "off", label: "common.off" },
};

const PRECISION: Record<Reading["precision"], MessageKey> = {
  exact: "locationSection.precision.exact",
  area: "locationSection.precision.area",
  city: "locationSection.precision.city",
};

/** "a moment ago", "10 minutes ago", "3 hours ago", or a date. */
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("locationSection.ago.moment");
  if (minutes < 60) return t("locationSection.ago.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("locationSection.ago.hours", { count: hours });
  return formatDate(at, { month: "short", day: "numeric" });
}

export function LocationSection() {
  const { state } = useStore();
  const [shown, setShown] = useState<LocationState | null>(null);
  /** Nothing to show: a hosted workspace takes no location at all, and a
   * workspace this computer joined as a member never shows the owner's. */
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api("/api/location")
      .then((s: LocationState) => {
        setShown(s);
        setError(null);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status !== undefined && e.status >= 400 && e.status < 500) setAbsent(true);
        else setError(e.message);
      });
  }, []);
  // again whenever the phone says something (the "location" frame)
  useEffect(load, [load, state.ticks.location]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  if (absent) return null;

  const forget = () => {
    setForgetting(true);
    api("/api/location", { method: "DELETE" })
      .then((s: LocationState) => setShown(s))
      .catch((e: Error) => setError(e.message))
      .finally(() => setForgetting(false));
  };

  const reading = shown?.location ?? null;
  const health = shown ? HEALTH[shown.sharing] : null;
  const closed = shown?.devices.find((d) => d.sharing === "on")?.background;

  // One line for what it is, one for where things stand. How it is kept,
  // and where on the phone to change it, waits behind the ? for whoever
  // wants to know.
  const hint = !shown
    ? null
    : shown.sharing === "off"
      ? t("locationSection.hint.off")
      : shown.sharing === "paused"
        ? reading
          ? t("locationSection.hint.pausedWithPlace")
          : t("locationSection.hint.paused")
        : reading
          ? closed === false
            ? t("locationSection.hint.whileOpen")
            : closed
              ? t("locationSection.hint.whenClosed")
              : null
          : t("locationSection.hint.waiting");

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0" data-setting-row="location">
      <ConnectionHeader
        icon={<MapPin size={14} className="shrink-0 text-muted-foreground" />}
        title={t("locationSection.location")}
        info={t("locationSection.info", { computer: ThisComputer() })}
        says={t("locationSection.letsYourAgentsKnowRoughly")}
        health={health && <HealthLine tone={health.tone} label={t(health.label)} />}
      />
      <ConnectionError>{error}</ConnectionError>

      {shown === null && !error && <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" />}

      {reading ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-foreground">{reading.place}</div>
            <div className="mt-0.5 text-small text-muted-foreground">
              {reading.precision === "exact" && reading.accuracy
                ? t("locationSection.readingExact", {
                    ago: ago(reading.observedAt, now),
                    device: reading.device,
                    precision: t(PRECISION[reading.precision]),
                    accuracy: reading.accuracy,
                  })
                : t("locationSection.reading", { ago: ago(reading.observedAt, now), device: reading.device, precision: t(PRECISION[reading.precision]) })}
            </div>
            {hint && <div className="mt-1 text-small text-muted-foreground">{hint}</div>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={forgetting}
            onClick={forget}
            aria-label={t("locationSection.forgetTheLastPlace")}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            {forgetting && <Loader2 size={13} className="animate-spin" />}
            {t("locationSection.forget")}
          </Button>
        </div>
      ) : (
        hint && <p className="mt-2 text-pretty text-small text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
