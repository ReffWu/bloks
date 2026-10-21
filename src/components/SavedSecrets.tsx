// The secrets agents asked for and the person saved, by name, each with
// Forget (GitHub 327). The security checkup lists them too, but it opens
// only on the computer Bloks runs on, and a workspace on a server
// elsewhere has no window of its own. These are the person's own keys, so
// they are kept here, beside the other keys every agent shares, and answer
// from any of the person's own devices. A value never comes back out.
import { useCallback, useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { SettingRow, SettingsGroup } from "./SettingsLayout";

export function SavedSecrets() {
  const { state } = useStore();
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/secrets")
      .then(({ secrets }) => {
        setNames(Array.isArray(secrets) ? secrets : []);
        setError(null);
      })
      .catch((e: Error & { code?: string }) =>
        // a server older than this app has no list to give
        setError(e.code === "unknown_route" ? "The computer this workspace runs on needs an update before it can list them here." : e.message),
      );
  }, []);
  // again whenever one is saved from a card or forgotten anywhere
  useEffect(load, [load, state.ticks.secrets]);

  const forget = async (name: string) => {
    const yes = await confirm({
      title: `Forget ${name}?`,
      body: "Agents stop getting it from their next turn. An agent that needs it again will ask you for it.",
      confirmLabel: "Forget",
      destructive: true,
    });
    if (!yes) return;
    setForgetting(name);
    try {
      const { secrets } = await api(`/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
      setNames(Array.isArray(secrets) ? secrets : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setForgetting(null);
    }
  };

  return (
    <SettingsGroup
      title="Saved secrets"
      footnote="Saved when an agent asks for one and you fill in its secure card. Every agent's turns get them as environment variables. Only the names are shown here."
    >
      {names === null ? (
        <SettingRow label="Saved secrets" description={error ? undefined : "Looking…"} error={error} />
      ) : names.length ? (
        names.map((name, i) => (
          <SettingRow
            key={name}
            // the first row is where a search for this group lands
            rowId={i === 0 ? "saved-secrets" : `saved-secret-${name}`}
            label={<span className="font-mono text-body">{name}</span>}
            control={
              <Button
                variant="ghost"
                size="sm"
                disabled={forgetting !== null}
                onClick={() => void forget(name)}
                className="text-muted-foreground hover:text-destructive"
              >
                {forgetting === name ? "Forgetting…" : "Forget"}
              </Button>
            }
          />
        ))
      ) : (
        <SettingRow
          rowId="saved-secrets"
          label="No saved secrets"
          description="When an agent asks you for a key or a password, what you save in its card is listed here by name."
        />
      )}
      {names !== null && error && (
        <p role="alert" className="px-5 py-3 text-pretty text-small text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  );
}
