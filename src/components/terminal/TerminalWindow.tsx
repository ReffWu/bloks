// An agent's terminal in a window of its own.
//
// The same bundle as the app, loaded with ?terminal=<agent>, the way the
// quick ask panel loads with ?quick. It shares the shells with the main
// window, because they live on the server, and nothing else: no store, no
// event stream, no sidebar. Opening tabs, renaming them or closing them
// here shows up in the main window's panel too, and the other way round,
// since both watch the same stream.
import { useEffect, useState } from "react";
import { TerminalPanel } from "@/components/Terminal";
import { ConfirmHost } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toast";
import { api } from "@/state/store";
import { followMenuKeys } from "@/lib/conversationKeys";
import { platformOf } from "@/lib/shortcuts";
import { t } from "@/lib/i18n";

/** The agent a terminal window was opened for, if the address names one. */
export function terminalWindowAgent(search: string): string | null {
  const id = new URLSearchParams(search).get("terminal");
  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

export function TerminalWindow({ botId }: { botId: string }) {
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // one message each is plenty to find a name by
    api("/api/bots?messages=0")
      .then((r: { bots?: Array<{ id: string; name: string; archivedAt?: number }> }) => {
        const bot = r.bots?.find((b) => b.id === botId && !b.archivedAt);
        if (bot) setName(bot.name);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [botId]);

  // ⌘⇧[ and ⌘⇧] from the menu bar step these tabs, as the keys do
  useEffect(() => {
    const bridge = window.bloks;
    if (!bridge?.onMenuCommand) return;
    return followMenuKeys(platformOf(), (handler) => bridge.onMenuCommand!(handler));
  }, []);

  return (
    <div className="flex h-full flex-col bg-card">
      {missing ? (
        <div className="m-auto max-w-sm px-6 text-center text-body text-muted-foreground">
          {t("terminalWindow.thisAgentIsNotHere")}
        </div>
      ) : name ? (
        <TerminalPanel botId={botId} botName={name} mode="window" onClose={() => window.close()} focusNonce={1} />
      ) : null}
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
