// The connected-apps catalogue and what is connected, for the Plugins page
// and the Customize sidebar's Installed list alike.
//
// The server returns either the live catalogue or a shorter shipped list,
// depending on which credential is configured, and nothing here minds
// which it got.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/state/store";

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

export function useConnectors() {
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Record<string, { connected: boolean }>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What comes back covers only the slugs asked about, so it is merged in:
  // replacing the map made every other connected app read as disconnected
  // the moment one was connected or dropped.
  const statusRef = useRef(status);
  statusRef.current = status;
  const refreshStatus = useCallback((slugs: string[]) => {
    if (!slugs.length) return Promise.resolve();
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        setStatus((current) => ({ ...current, ...(r.services ?? {}) }));
        setError(r.error ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setConfigured(Boolean(r.configured));
        if (r.configured) void refreshStatus((r.cards ?? []).map((c: ToolkitCard) => c.slug).slice(0, 40));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

  const connect = (slug: string) => {
    setBusySlug(slug);
    setError(null);
    api(`/api/connectors/${slug}/authorize`, { method: "POST" })
      .then(({ url }) => {
        window.open(url);
        // The sign-in finishes in the browser, often after a password and a
        // consent screen, so keep looking for two minutes rather than thirty
        // seconds, and stop as soon as it lands. Read through a ref: the
        // state this closure saw is the state before the click.
        let tries = 0;
        const timer = setInterval(() => {
          if (statusRef.current[slug]?.connected || ++tries > 24) return clearInterval(timer);
          void refreshStatus([slug]);
        }, 5000);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const disconnect = (slug: string) => {
    const label = cards?.find((c) => c.slug === slug)?.label ?? slug;
    // every account behind it goes, and agents stop being able to use it
    if (!window.confirm(`Disconnect ${label}? Your agents will no longer be able to use it until you connect it again.`)) {
      return;
    }
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  // tools the person named during first-run setup come first, so the page
  // opens on the things they said they use every day
  const introPicks = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("bloks-intro-plugins") ?? "[]"));
    } catch {
      return new Set<string>();
    }
  }, []);
  const ordered = useMemo(
    () => [...(cards ?? [])].sort((a, b) => Number(introPicks.has(b.slug)) - Number(introPicks.has(a.slug))),
    [cards, introPicks],
  );
  const installed = useMemo(() => ordered.filter((c) => status[c.slug]?.connected), [ordered, status]);

  return {
    cards,
    ordered,
    installed,
    source,
    configured,
    status,
    busySlug,
    refreshing,
    error,
    refreshStatus,
    connect,
    disconnect,
    statusRef,
  };
}

export type Connectors = ReturnType<typeof useConnectors>;
