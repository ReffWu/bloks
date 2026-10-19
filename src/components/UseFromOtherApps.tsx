// Bloks from Claude Desktop, Claude Code, Cursor and the rest
// (bin/bloks-mcp.mjs): what to paste where, with the path filled in.
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Copy } from "@/components/icons";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

interface McpConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

export function UseFromOtherApps() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [which, setWhich] = useState<"desktop" | "code" | "cursor">("desktop");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api("/api/mcp-config").then(setConfig).catch(() => setConfig(null));
  }, []);
  if (!config) return null;

  const json = JSON.stringify({ mcpServers: { bloks: { command: config.command, args: config.args, env: config.env } } }, null, 2);
  const code = `claude mcp add bloks ${Object.entries(config.env)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ")} -- ${[config.command, ...config.args].map(shellQuote).join(" ")}`;
  const text = which === "code" ? code : json;
  const where =
    which === "desktop"
      ? "In Claude Desktop: Settings, Developer, Edit Config, and add this to claude_desktop_config.json. Then restart Claude."
      : which === "cursor"
        ? "In Cursor: Settings, MCP, Add new global MCP server, and paste this."
        : "In a terminal:";

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="text-ui font-semibold text-foreground">Use Bloks from other AI apps</div>
      <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
        Let Claude, Cursor or another MCP app hand your agents work, read their conversations, and see what is waiting on
        you. It cannot answer approvals, delete anything or change settings; those stay here. Bloks has to be running.
      </div>
      <div className="mt-3 flex gap-1 rounded-lg bg-muted p-0.5 text-body">
        {(
          [
            ["desktop", "Claude Desktop"],
            ["code", "Claude Code"],
            ["cursor", "Cursor"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setWhich(key)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition-colors",
              which === key ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-small text-muted-foreground">{where}</div>
      <div className="relative mt-1.5">
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/40 p-3 pr-10 font-mono text-small text-foreground">
          {text}
        </pre>
        <button
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
