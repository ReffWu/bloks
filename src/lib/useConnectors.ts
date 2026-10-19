// The connected-apps catalogue and what is connected, for the Plugins page
// and the Customize sidebar's Installed list alike.
//
// The server returns either the live catalogue or a shorter shipped list,
// depending on which credential is configured, and nothing here minds
// which it got.
//
// Connect never needs a key to be pressed. Without one it asks for the key
// instead (ComposioKeyDialog, drawn by whoever holds this hook), and once
// the key lands it carries straight on into the sign-in it was asked for.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, useStore } from "@/state/store";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

/** What the key dialog is open for: an app to connect once the key is
 * saved, or none when it was opened to add a key on its own. */
export interface KeyAsk {
  slug: string | null;
}

export function useConnectors() {
  const { state } = useStore();
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Record<string, { connected: boolean }>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyAsk, setKeyAsk] = useState<KeyAsk | null>(null);

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

  // A key saved anywhere (this dialog, Settings, another window) arrives
  // as a new config status, and the catalogue is asked again: which list
  // comes back, and whether apps can connect at all, both hang on it.
  const keyed = state.config?.composio.configured;
  const catalogued = state.config?.composio.apiKeyConfigured;
  const [catalogTurn, setCatalogTurn] = useState(0);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (keyed === undefined) return;
    const now = `${keyed}/${Boolean(catalogued)}`;
    // the first status to arrive is the one the first fetch already saw
    if (seen.current !== null && seen.current !== now) setCatalogTurn((n) => n + 1);
    seen.current = now;
  }, [keyed, catalogued]);

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
  }, [refreshStatus, catalogTurn]);

  const configuredRef = useRef(configured);
  configuredRef.current = configured;

  const signIn = (slug: string) => {
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

  /** Connect, or ask for the key first when there is none to connect with. */
  const connect = (slug: string) => {
    if (!configuredRef.current) return setKeyAsk({ slug });
    signIn(slug);
  };

  const askForKey = (slug: string | null = null) => setKeyAsk({ slug });
  const closeKeyAsk = () => setKeyAsk(null);

  /** The key was accepted: apps can connect now, and the app the dialog
   * was opened for goes straight on to its sign-in. */
  const keySaved = () => {
    const slug = keyAsk?.slug ?? null;
    setConfigured(true);
    setKeyAsk(null);
    if (slug) signIn(slug);
  };

  const disconnect = async (slug: string) => {
    const label = cards?.find((c) => c.slug === slug)?.label ?? slug;
    // every account behind it goes, and agents stop being able to use it
    const yes = await confirm({
      title: `Disconnect ${label}?`,
      body: "Agents can't use it until you reconnect.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!yes) return;
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => {
        toast(`Disconnected ${label}`);
        return refreshStatus([slug]);
      })
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
    keyAsk,
    askForKey,
    closeKeyAsk,
    keySaved,
  };
}

export type Connectors = ReturnType<typeof useConnectors>;
