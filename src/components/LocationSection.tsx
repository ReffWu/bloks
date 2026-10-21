// Where you are, as your iPhone last told this computer (server/location.ts).
//
// The phone is where it is switched on, paused and stopped, so this card
// has no switch of its own: it says whether the phone is sharing, the last
// place and how long ago, which phone said it, and offers Forget, which
// drops what this computer holds. Nothing here asks the phone anything.
import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api, useStore } from "@/state/store";
import { ConnectionError, ConnectionHeader, HealthLine, type Health } from "./ConnectionKit";

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

const HEALTH: Record<Sharing, { tone: Health; label: string }> = {
  on: { tone: "on", label: "Sharing" },
  paused: { tone: "wait", label: "Paused" },
  off: { tone: "off", label: "Off" },
};

const PRECISION: Record<Reading["precision"], string> = {
  exact: "Exact position",
  area: "Neighbourhood and city",
  city: "City only",
};

/** "a moment ago", "10 minutes ago", "3 hours ago", or a date. */
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
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

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0" data-setting-row="location">
      <ConnectionHeader
        icon={<MapPin size={14} className="shrink-0 text-muted-foreground" />}
        title="Location"
        says="Your agents can know roughly where you are when you turn on Location in the Bloks app on your iPhone. This computer keeps only the last place, never a trail, and members never see it."
        health={health && <HealthLine tone={health.tone} label={health.label} />}
      />
      <ConnectionError>{error}</ConnectionError>

      {shown === null && !error && <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" />}

      {shown && (
        <div className="mt-4 border-t pt-3">
          {reading ? (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium text-foreground">{reading.place}</div>
                <div className="mt-0.5 text-small text-muted-foreground">
                  {ago(reading.observedAt, now)} from {reading.device} · {PRECISION[reading.precision]}
                  {reading.precision === "exact" && reading.accuracy ? `, to about ${reading.accuracy} m` : ""}
                </div>
                {shown.sharing === "paused" && (
                  <div className="mt-1 text-small text-muted-foreground">Paused on your iPhone, so your agents are not told this.</div>
                )}
              </div>
              <Button variant="secondary" size="sm" disabled={forgetting} onClick={forget}>
                {forgetting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Forget
              </Button>
            </div>
          ) : (
            <div className="text-body text-muted-foreground">
              {shown.sharing === "on"
                ? "Sharing is on. Nothing kept yet: your iPhone says where it is the next time it moves a fair way or Bloks is opened there."
                : shown.sharing === "paused"
                  ? "Paused on your iPhone. Nothing kept here."
                  : "Off. Nothing kept here."}
            </div>
          )}
          <div className="mt-3 text-small leading-relaxed text-muted-foreground">
            {shown.sharing === "on" && closed === false
              ? "Your iPhone shares only while Bloks is open on it. "
              : shown.sharing === "on" && closed
                ? "Your iPhone also shares with Bloks closed, when it moves a fair way or arrives somewhere. "
                : ""}
            Turn it on, pause it or stop it on your iPhone, in Settings, Location. Forget clears what this computer holds; to stop new places arriving, stop sharing on the phone.
          </div>
        </div>
      )}
    </div>
  );
}
