// An app's own page, opened from the Plugins catalogue and from View
// details in Settings: what it is, what an agent can do with it, and
// three things to try, each one click from being typed into an agent's
// message box. Connected, it offers Manage (its page in Settings) and Try
// now; not yet, it offers to connect.
import { ArrowLeft } from "@/components/icons";
import { ArrowRight } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { MoreHorizontal } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Settings } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { useStore } from "@/state/store";
import type { Connectors, ToolkitCard } from "@/lib/useConnectors";
import { detailsFor } from "@/lib/appDetails";
import { agentForApps, tryPrompt } from "@/lib/tryPrompt";
import { ServiceIcon } from "./Customize";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { useState } from "react";

const pill =
  "flex h-10 items-center gap-2 rounded-full px-4 text-ui font-medium outline-none transition-[background-color,opacity,scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-40";

export function AppDetailsPage({ slug, connectors }: { slug: string; connectors: Connectors }) {
  const { state, dispatch } = useStore();
  const [note, setNote] = useState<string | null>(null);
  const card = connectors.cards?.find((c) => c.slug === slug);
  const back = () => dispatch({ type: "openCustomize", tab: "plugins", app: null });

  if (!card) {
    return (
      <div>
        <BackToPlugins onBack={back} />
        <div className="mt-10 flex items-center gap-2 text-ui text-muted-foreground">
          {connectors.cards === null ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Loading
            </>
          ) : (
            "App not found."
          )}
        </div>
      </div>
    );
  }

  const details = detailsFor(card);
  const connected = Boolean(connectors.status[card.slug]?.connected);
  const busy = connectors.busySlug === card.slug;
  const users = state.bots.filter((b) => !b.hidden && b.composio !== false).length;
  const send = (prompt: string) => {
    if (!connected) return connectors.connect(card.slug);
    const bot = tryPrompt(state, dispatch, `Using ${card.label}: ${prompt}`);
    if (!bot) setNote("No agent can use apps yet. Turn it on in an agent's settings.");
  };

  return (
    <div>
      <BackToPlugins onBack={back} />

      <header className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          {/* the mark at the size the catalogue serves it, beside the
              name: scaled up, the small logos go soft */}
          <h1 className="flex items-center gap-3 text-balance text-display font-semibold text-foreground">
            <ServiceIcon card={card} />
            {card.label}
          </h1>
          <p className="mt-1 text-ui text-muted-foreground">Through Composio Connect</p>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${card.label} options`}
                  className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
                >
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <MoreHorizontal size={18} />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  <DropdownMenuItem onClick={() => connectors.connect(card.slug)}>Sign in again</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => connectors.disconnect(card.slug)} className="text-destructive focus:text-destructive">
                    <Trash2 />
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => dispatch({ type: "openPluginSettings", focus: { kind: "app", id: card.slug } })}
                className={cn(pill, "border bg-card text-foreground hover:bg-accent")}
              >
                <Settings size={16} />
                Manage
              </button>
              <button onClick={() => send(details.prompts[0])} className={cn(pill, "bg-foreground text-background hover:opacity-90")}>
                <MessageSquare size={16} />
                Try now
              </button>
            </>
          ) : (
            <button
              onClick={() => connectors.connect(card.slug)}
              disabled={busy}
              className={cn(pill, "bg-foreground text-background hover:opacity-90")}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Connect
            </button>
          )}
        </div>
      </header>

      <Hero card={card} accent={details.accent} prompts={details.prompts} connected={connected} onPick={send} />
      {note && <p className="mt-3 text-body text-destructive">{note}</p>}
      {!connected && (
        <p className="mt-3 text-body text-muted-foreground">Connect {card.label} to try these.</p>
      )}

      <p className="mt-8 text-pretty text-lead leading-relaxed text-foreground">{details.about}</p>

      <h2 className="mt-10 border-b pb-3 text-title font-semibold text-foreground">Information</h2>
      <dl className="mt-4 grid grid-cols-[160px_minmax(0,1fr)] gap-y-3.5 text-ui">
        <dt className="text-muted-foreground">Category</dt>
        <dd className="text-foreground">{details.category}</dd>
        <dt className="text-muted-foreground">Connects through</dt>
        <dd className="text-foreground">Composio Connect</dd>
        {card.domain && (
          <>
            <dt className="text-muted-foreground">Website</dt>
            <dd>
              <a href={`https://${card.domain}`} target="_blank" rel="noreferrer" className="text-foreground underline-offset-2 hover:underline">
                {card.domain}
              </a>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Agents</dt>
        <dd className="text-foreground">
          {users === 0 ? "None yet" : `${users} ${users === 1 ? "agent" : "agents"} can use apps`}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="flex items-center gap-2 text-foreground">
          <span className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-muted-foreground/50")} />
          {connected ? "Connected" : "Not connected"}
        </dd>
      </dl>
    </div>
  );
}

function BackToPlugins({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1.5 text-ui text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft size={16} />
      Plugins
    </button>
  );
}

/**
 * The header behind the prompts: the app's own colour, washed out over
 * the ground, so a page of Slack and a page of Stripe feel like
 * themselves. The prompts sit on it as glass, each with the app's name in
 * front, the way it reads once it is in the box.
 *
 * Each theme gets its own version of the same wash. Dark keeps the deep
 * ground with the colour glowing out of it; light lays a softer wash over
 * the card colour, with white glass and dark text, so the page does not
 * suddenly turn to night in the middle. Both are handed over as custom
 * properties and picked by the dark variant, since the accent is per app
 * and cannot live in the stylesheet.
 */
function Hero({
  card,
  accent,
  prompts,
  connected,
  onPick,
}: {
  card: ToolkitCard;
  accent: string;
  prompts: string[];
  connected: boolean;
  onPick: (prompt: string) => void;
}) {
  const agent = useStore().state;
  const to = agentForApps(agent);
  const wash = {
    "--hero-light": [
      `radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, ${accent} 24%, transparent) 0%, transparent 60%)`,
      `radial-gradient(90% 80% at 100% 100%, color-mix(in srgb, ${accent} 16%, transparent) 0%, transparent 65%)`,
      `radial-gradient(70% 60% at 85% 10%, color-mix(in srgb, #7c8aff 14%, transparent) 0%, transparent 70%)`,
      `color-mix(in srgb, ${accent} 5%, var(--card))`,
    ].join(", "),
    "--hero-dark": [
      `radial-gradient(120% 90% at 12% 0%, color-mix(in srgb, ${accent} 70%, transparent) 0%, transparent 60%)`,
      `radial-gradient(90% 80% at 100% 100%, color-mix(in srgb, ${accent} 45%, transparent) 0%, transparent 65%)`,
      `radial-gradient(70% 60% at 85% 10%, color-mix(in srgb, #7c8aff 25%, transparent) 0%, transparent 70%)`,
      "#14141b",
    ].join(", "),
    // the name in front of each prompt: the accent darkened enough to read
    // on white glass, or lifted enough to read on dark glass
    "--hero-name-light": `color-mix(in srgb, ${accent} 60%, black)`,
    "--hero-name-dark": `color-mix(in srgb, ${accent} 40%, white)`,
  } as React.CSSProperties;
  return (
    <div
      className="relative mt-8 overflow-hidden rounded-[28px] border border-black/[0.06] px-5 py-10 [background:var(--hero-light)] sm:px-14 dark:border-transparent dark:[background:var(--hero-dark)]"
      style={wash}
    >
      <div className="mx-auto flex max-w-[680px] flex-col gap-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPick(prompt)}
            title={connected ? (to ? `Write this to ${to.name}` : undefined) : `Connect ${card.label} first`}
            className="group flex items-center gap-4 rounded-2xl bg-white/80 px-5 py-4 text-left text-lead leading-relaxed text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.07] backdrop-blur-md transition-[background-color,scale] duration-150 ease-out hover:bg-white active:scale-[0.99] dark:bg-black/45 dark:text-white/90 dark:shadow-none dark:ring-white/10 dark:hover:bg-black/55"
          >
            <span className="min-w-0 flex-1">
              <span className="mr-1.5 inline-flex translate-y-[3px] items-center gap-1.5 font-medium [color:var(--hero-name-light)] dark:[color:var(--hero-name-dark)]">
                <ServiceIcon card={card} size={16} />
                {card.label}
              </span>
              {prompt}
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-foreground transition-colors group-hover:bg-black/10 dark:bg-white/10 dark:text-white dark:group-hover:bg-white/20">
              <ArrowRight size={17} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
