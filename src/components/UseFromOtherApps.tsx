// Bloks from Claude Desktop, Claude Code, Cursor and the rest
// (bin/bloks-mcp.mjs): what to paste where, with the path filled in.
//
// A group like any other on the page: what it is above the card, then
// inside it the app, the steps in that app as short numbered lines, and
// the snippet with its own Copy, named for the file it goes in.
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Copy } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SettingsGroup } from "./SettingsLayout";
import { t, type MessageKey } from "@/lib/i18n";

interface McpConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

type Which = "desktop" | "code" | "cursor";

// Each app's name is its own; the steps are keys, read when they draw.
const APPS: Record<Which, { label: string; file: string; steps: MessageKey[] }> = {
  desktop: {
    label: "Claude Desktop",
    file: "claude_desktop_config.json",
    steps: ["useFromOtherApps.desktop.openConfig", "useFromOtherApps.desktop.addToFile", "useFromOtherApps.desktop.restart"],
  },
  code: { label: "Claude Code", file: "Terminal", steps: ["useFromOtherApps.code.runInTerminal"] },
  cursor: {
    label: "Cursor",
    file: "mcp.json",
    steps: ["useFromOtherApps.cursor.openSettings", "useFromOtherApps.cursor.paste"],
  },
};

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

export function UseFromOtherApps() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [which, setWhich] = useState<Which>("desktop");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api("/api/mcp-config").then(setConfig).catch(() => setConfig(null));
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!config) return null;

  const json = JSON.stringify({ mcpServers: { bloks: { command: config.command, args: config.args, env: config.env } } }, null, 2);
  const code = `claude mcp add bloks ${Object.entries(config.env)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ")} -- ${[config.command, ...config.args].map(shellQuote).join(" ")}`;
  const text = which === "code" ? code : json;
  const app = APPS[which];

  return (
    <SettingsGroup
      title={t("useFromOtherApps.useBloksFromOtherAi")}
      description={t("useFromOtherApps.claudeCursorAndOtherMcp")}
      footnote={t("useFromOtherApps.approvalsDeletingAndSettingsStay")}
    >
      <div data-setting-row="use-bloks-from-other-ai-apps" className="p-5 transition-colors duration-700">
        <Segmented<Which>
          aria-label={t("useFromOtherApps.whichApp")}
          size="sm"
          value={which}
          onChange={(next) => {
            setWhich(next);
            setCopied(false);
          }}
          options={(Object.keys(APPS) as Which[]).map((key) => ({ value: key, label: APPS[key].label }))}
          className="w-full max-w-[400px]"
        />
        {app.steps.length > 1 ? (
          <ol className="mt-4 flex flex-col gap-1.5">
            {app.steps.map((step, i) => (
              <li key={step} className="flex items-baseline gap-2.5 text-body text-foreground">
                <span aria-hidden className="w-3 shrink-0 text-right text-small tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 text-pretty">{t(step)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-body text-foreground">{t(app.steps[0])}</p>
        )}
        <div className="mt-3 overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex items-center justify-between gap-3 border-b py-1 pl-3 pr-1">
            <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">{app.file}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={copied ? t("common.copied") : t("useFromOtherApps.copySetup", { app: app.label })}
              onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-small text-foreground">{text}</pre>
        </div>
      </div>
    </SettingsGroup>
  );
}
