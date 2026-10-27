// Settings, Browser: which sites agents may use in the Bloks browser,
// and whether a new one asks first.
//
// The rules are the workspace's own and live on its server
// (server/app-browser.ts), so this page reads and changes them from any
// of the person's devices; the browser itself, its downloads and its
// sign-ins are the desktop app's, and those rows show only there.
import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { X } from "@/components/icons";
import { hasOwnBrowser } from "@/lib/appBrowser";
import { SavedMark, SettingRow, SettingsGroup, SettingsSkeleton } from "../SettingsLayout";

interface Settings {
  mode: "ask" | "auto";
  allow: string[];
  deny: string[];
}

export function BrowserPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/browser/settings")
      .then((said: { settings: Settings; downloads: string }) => {
        setSettings(said.settings);
        setFolder(said.downloads);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    try {
      const said = (await api("/api/browser/settings", { method: "PUT", body: JSON.stringify(patch) })) as { settings: Settings };
      setSettings(said.settings);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const chooseMode = async (mode: Settings["mode"]) => {
    if (!settings || mode === settings.mode) return;
    // letting agents go anywhere is a widening, and asks who is there
    if (mode === "auto" && window.bloks?.authConfirm) {
      const answer = await window.bloks.authConfirm("let agents open any site in the Bloks browser without asking");
      if (answer === "denied" || answer === "cancelled") return;
    }
    void save({ mode });
  };

  if (error && !settings) return <p className="text-body text-destructive">{error}</p>;
  if (!settings) return <SettingsSkeleton rows={3} label="Loading browser settings" />;

  return (
    <>
      <SettingsGroup
        title="When an agent opens a site"
        footnote="Typing a password or a card number, and choosing a file to upload, always ask you first, whichever you pick. Agents never open files on this computer, the browser's own pages, or Bloks itself."
      >
        <SettingRow
          label="Asks"
          description={
            settings.mode === "ask"
              ? "A site that is not on your list asks you on a card, the first time in a turn."
              : "Any site but the ones you block, without asking."
          }
          control={
            <div className="flex items-center gap-2">
              <SavedMark on={saved} />
              <Segmented
                aria-label="When an agent opens a site"
                value={settings.mode}
                onChange={(mode) => void chooseMode(mode)}
                options={[
                  { value: "ask", label: "Ask first" },
                  { value: "auto", label: "Auto" },
                ]}
              />
            </div>
          }
        />
      </SettingsGroup>

      <SiteList
        title="Sites agents may use"
        empty="None yet. Press Always allow on a card, or add a site here."
        sites={settings.allow}
        onChange={(allow) => save({ allow })}
        footnote={settings.mode === "auto" ? "In Auto every site is open to agents, so this list only matters if you go back to Ask first." : "A site covers its subdomains: example.com includes shop.example.com."}
      />
      <SiteList
        title="Sites agents never use"
        empty="None. Agents may be asked about any site."
        sites={settings.deny}
        onChange={(deny) => save({ deny })}
        footnote="Blocked beats allowed. A page that tries to take an agent to one of these stays where it was."
      />
      {error && (
        <p role="alert" className="-mt-6 mb-9 px-1 text-small text-destructive">
          {error}
        </p>
      )}

      {hasOwnBrowser() && (
        <SettingsGroup title="This workspace's browser" footnote="Its sign-ins are this workspace's own: another workspace, and the rest of Bloks, never see them.">
          <SettingRow
            label="Downloads"
            description={<span className="break-all">{folder}</span>}
            control={
              <Button size="sm" variant="secondary" onClick={() => void window.bloks?.browserDo?.("openDownloads")}>
                Open
              </Button>
            }
          />
          <SettingRow
            label="Sign out of every site"
            description="Clears the cookies, saved sign-ins and cache of this workspace's browser."
            control={
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void confirm({
                    title: "Sign out of every site?",
                    body: "You and your agents will have to sign in again in this workspace's browser.",
                    confirmLabel: "Sign out",
                    destructive: true,
                  }).then(async (yes) => {
                    if (!yes) return;
                    const said = await window.bloks?.browserDo?.("forgetSites");
                    if (said?.error) toast.error(said.error);
                    else toast.success("Signed out of every site in this workspace's browser.");
                  })
                }
              >
                Sign out
              </Button>
            }
          />
        </SettingsGroup>
      )}
    </>
  );
}

function SiteList({
  title,
  empty,
  sites,
  onChange,
  footnote,
}: {
  title: string;
  empty: string;
  sites: string[];
  onChange: (sites: string[]) => Promise<boolean>;
  footnote: string;
}) {
  const [adding, setAdding] = useState("");
  const add = async () => {
    const site = adding.trim();
    if (!site) return;
    if (await onChange([...sites, site])) setAdding("");
  };
  return (
    <SettingsGroup title={title} footnote={footnote}>
      {sites.length === 0 ? (
        <p className="px-5 py-4 text-body text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {sites.map((site) => (
            <li key={site} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-ui text-foreground">{site}</span>
              <button
                type="button"
                aria-label={`Remove ${site}`}
                title={`Remove ${site}`}
                onClick={() => void onChange(sites.filter((s) => s !== site))}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2 px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="example.com"
          aria-label={`Add to ${title.toLowerCase()}`}
          spellCheck={false}
          autoCapitalize="off"
          className="h-8 flex-1"
        />
        <Button size="sm" variant="secondary" type="submit" disabled={!adding.trim()}>
          Add
        </Button>
      </form>
    </SettingsGroup>
  );
}
