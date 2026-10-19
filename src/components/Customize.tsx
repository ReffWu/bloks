// Customize: what your agents can reach and what they know how to do, as
// a place of its own off the main rail. A sidebar of its own lists the two
// pages and the apps already connected; each page is a catalogue laid out
// to read, two to a row, with the one action each item needs beside it.
//
// Plugins are the connected apps (Composio Connect) and the interfaces MCP
// servers draw; Skills are the instructions agents pick up, the ones on
// this machine and the catalogue they come from.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Lock } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { MoreHorizontal } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Puzzle } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { Search } from "@/components/icons";
import { Settings } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore, type CustomizeTab, type Skill } from "@/state/store";
import { useConnectors, type Connectors, type ToolkitCard } from "@/lib/useConnectors";
import { McpAppsCard } from "./McpApps";
import { AddMcpServerDialog, useMcpServers } from "./McpServers";
import { AppDetailsPage } from "./AppDetails";
import { detailsFor } from "@/lib/appDetails";
import { tryPrompt } from "@/lib/tryPrompt";
import { SkillCatalog } from "./SkillCatalog";
import { AddSkillDialog, ProposedSkill, type Proposal } from "./SkillsPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

/** An app's mark: its own artwork, then its site's icon, then a letter,
 * because one broken image in a grid of logos looks worse than a letter. */
export function ServiceIcon({ card, size = 24 }: { card: ToolkitCard; size?: number }) {
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  const box = { width: size, height: size };
  if (stage === 0 && card.logo) {
    return (
      <img
        src={`/api/connectors/icon?src=${encodeURIComponent(card.logo)}`}
        alt=""
        style={box}
        className="rounded-md object-contain"
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`/api/connectors/icon?domain=${encodeURIComponent(card.domain)}`}
        alt=""
        style={box}
        className="rounded-md object-contain"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <span
      style={box}
      className="flex items-center justify-center rounded-md bg-muted text-caption font-semibold text-muted-foreground"
    >
      {card.label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The tile an item's mark sits on, the same for an app and a skill. */
function Tile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {children}
    </span>
  );
}

const pill =
  "flex h-9 items-center rounded-full outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97]";

/** The heading every Customize page shares: title, line, and the tools. */
function PageHeader({
  title,
  says,
  search,
  onSearch,
  searchRef,
  placeholder,
  onRefresh,
  refreshing,
  onSettings,
  add,
}: {
  title: string;
  says: string;
  search: string;
  onSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  onRefresh: () => void;
  refreshing?: boolean;
  onSettings: () => void;
  add: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-balance text-display font-semibold text-foreground">{title}</h1>
        <p className="mt-1.5 text-pretty text-ui text-muted-foreground">{says}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex h-9 w-[240px] items-center gap-2 rounded-full border bg-card px-3.5 transition-colors duration-150 focus-within:border-ring/50 lg:w-[280px]">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (onSearch(""), e.currentTarget.blur())}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          title="Refresh"
          className={cn(pill, "size-9 justify-center text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          <RefreshCw size={16} className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
        </button>
        <button
          onClick={onSettings}
          aria-label="Settings for these"
          title="Settings"
          className={cn(pill, "size-9 justify-center text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          <Settings size={16} />
        </button>
        {add}
      </div>
    </header>
  );
}

/** Two or three choices of what a page shows, as pills. */
function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="mt-7 flex items-center gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-4 text-body font-medium outline-none transition-colors duration-150",
            option.value === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-9 flex items-center justify-between border-b pb-3">
      <h2 className="text-lead font-semibold text-foreground">{children}</h2>
      {aside}
    </div>
  );
}

/** "See A, B, and 12 more": what the fold is hiding, by name. */
function MoreLine({ hidden, onClick }: { hidden: string[]; onClick: () => void }) {
  if (!hidden.length) return null;
  const named = hidden.slice(0, 2);
  const rest = hidden.length - named.length;
  return (
    <button
      onClick={onClick}
      className="mt-3 px-1 text-left text-body text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      See {named.join(", ")}
      {rest > 0 ? `, and ${rest} more` : ""}
    </button>
  );
}

/** One item in a catalogue grid: its tile, its name and line, its action. */
function GridItem({
  tile,
  name,
  line,
  action,
  onOpen,
}: {
  tile: React.ReactNode;
  name: React.ReactNode;
  line?: string;
  action?: React.ReactNode;
  onOpen?: () => void;
}) {
  const body = (
    <>
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-foreground">{name}</span>
        {line && <span className="mt-0.5 block truncate text-body text-muted-foreground">{line}</span>}
      </span>
    </>
  );
  return (
    <div className="group flex min-w-0 items-center gap-3.5 rounded-xl px-2 py-3 transition-colors duration-150 hover:bg-accent/40">
      {onOpen ? (
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none">
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3.5">{body}</span>
      )}
      {action && <span className="flex shrink-0 items-center">{action}</span>}
    </div>
  );
}

const ROUND = "flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:opacity-40";

// ---------------------------------------------------------------------------

/** How many items a section shows before it folds the rest behind a line. */
const FOLD = 8;

function PluginsPage({
  connectors,
  search,
  setSearch,
  searchRef,
}: {
  connectors: Connectors;
  search: string;
  setSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { state, dispatch } = useStore();
  const { ordered, installed, configured, source, status, busySlug, refreshing, error, refreshStatus, connect, disconnect, statusRef, cards } =
    connectors;
  const { servers, reload: reloadServers } = useMcpServers();
  const [view, setView] = useState<"apps" | "mcp">("apps");
  const [unfolded, setUnfolded] = useState(false);
  const [addingServer, setAddingServer] = useState(false);
  const [addingSkill, setAddingSkill] = useState(false);
  const [tried, setTried] = useState<string | null>(null);
  const toKeys = () => dispatch({ type: "toggleAppSettings", open: true, page: "apps" });
  const toSettings = () => dispatch({ type: "openPluginSettings", focus: null });
  const openApp = (card: ToolkitCard) => dispatch({ type: "openCustomize", tab: "plugins", app: card.slug });
  const unfinished = (servers ?? []).filter((server) => (server.needs ?? []).length > 0);
  const tryNow = (card: ToolkitCard) => {
    const bot = tryPrompt(state, dispatch, `Using ${card.label}: ${detailsFor(card).prompts[0]}`);
    if (!bot) setTried("No agent can use connected apps. Switch it on in an agent's settings first.");
  };

  const q = search.trim().toLowerCase();
  const matching = ordered.filter((c) => !q || `${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(q));
  const notConnected = matching.filter((c) => !status[c.slug]?.connected);
  const shown = q || unfolded ? notConnected : notConnected.slice(0, FOLD);

  // Status is fetched for the first forty apps up front. A search that
  // surfaces one further down asks about it too, or an app you connected
  // would show a plus just because it sorted late.
  useEffect(() => {
    if (!configured || !q) return;
    const unknown = matching.map((c) => c.slug).filter((s) => !(s in statusRef.current)).slice(0, 40);
    if (!unknown.length) return;
    const timer = setTimeout(() => void refreshStatus(unknown), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, configured, cards]);

  const connectAction = (card: ToolkitCard) =>
    busySlug === card.slug ? (
      <span className={ROUND}>
        <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
      </span>
    ) : (
      <button
        onClick={() => connect(card.slug)}
        disabled={!configured}
        aria-label={`Connect ${card.label}`}
        title={configured ? `Connect ${card.label}` : "Add a Composio Connect key in Settings first"}
        className={ROUND}
      >
        <Plus size={17} />
      </button>
    );

  const manageAction = (card: ToolkitCard) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={`${card.label} options`} className={cn(ROUND, "data-[state=open]:bg-accent")}>
          {busySlug === card.slug ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={17} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onClick={() => tryNow(card)}>
          <MessageSquare />
          Try now
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => dispatch({ type: "openPluginSettings", focus: { kind: "app", id: card.slug } })}>
          <Settings />
          Manage
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => disconnect(card.slug)} className="text-destructive focus:text-destructive">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <PageHeader
        title="Plugins"
        says="Connect apps so your agents can work across your tools."
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        placeholder="Search plugins"
        onRefresh={() => void refreshStatus(ordered.map((c) => c.slug).slice(0, 40))}
        refreshing={refreshing}
        onSettings={toSettings}
        add={
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(pill, "gap-1 bg-foreground px-4 text-body font-medium text-background hover:opacity-90")}
            >
              Add
              <ChevronDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuItem onClick={() => setAddingServer(true)}>
                <Puzzle />
                Add custom MCP server
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddingSkill(true)}>
                <Sparkles />
                Add a skill
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Pills
        value={view}
        onChange={setView}
        options={[
          { value: "apps", label: "Apps" },
          { value: "mcp", label: "MCP apps" },
        ]}
      />

      {view === "mcp" ? (
        <div className="mt-6">
          <McpAppsCard />
        </div>
      ) : (
        <>
          {!configured && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
              <span className="text-ui text-foreground">
                Connect apps by adding a Composio Connect key.
                <span className="text-muted-foreground"> Your agents sign in through it, once for all of them.</span>
              </span>
              <button
                onClick={toKeys}
                className={cn(pill, "h-8 bg-foreground px-3.5 text-body font-medium text-background hover:opacity-90")}
              >
                Add a key
              </button>
            </div>
          )}
          {configured && source === "curated" && (
            <p className="mt-5 text-body text-muted-foreground">
              Showing a curated set.{" "}
              <button onClick={toKeys} className="underline underline-offset-2 hover:text-foreground">
                Add a Composio API key
              </button>{" "}
              to browse the full catalogue.
            </p>
          )}
          {(error || tried) && <p className="mt-4 text-body text-destructive">{error ?? tried}</p>}

          {unfinished.length > 0 && !q && (
            <>
              <SectionTitle>Needs setup</SectionTitle>
              <div className="flex flex-col">
                {unfinished.map((server) => (
                  <GridItem
                    key={server.id}
                    tile={
                      <Tile>
                        <Puzzle size={17} />
                      </Tile>
                    }
                    name={server.name}
                    line={`Waiting for ${(server.needs ?? []).join(", ")}`}
                    action={
                      <button
                        onClick={() => dispatch({ type: "openPluginSettings", focus: { kind: "mcp", id: server.id } })}
                        className="h-8 rounded-lg border px-3 text-body font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        Finish setup
                      </button>
                    }
                  />
                ))}
              </div>
            </>
          )}

          {installed.length > 0 && !q && (
            <>
              <SectionTitle>Connected</SectionTitle>
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                {installed.map((card) => (
                  <GridItem
                    key={card.slug}
                    tile={
                      <Tile>
                        <ServiceIcon card={card} />
                      </Tile>
                    }
                    name={card.label}
                    line={card.blurb}
                    action={manageAction(card)}
                  />
                ))}
              </div>
            </>
          )}

          <SectionTitle
            aside={
              cards && (
                <span className="text-body tabular-nums text-muted-foreground">
                  {q ? `${matching.length} found` : `${notConnected.length} apps`}
                </span>
              )
            }
          >
            {q ? "Results" : installed.length ? "More apps" : "Popular"}
          </SectionTitle>
          {cards === null ? (
            <div className="flex items-center gap-2 py-10 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading the catalogue
            </div>
          ) : matching.length === 0 ? (
            <p className="py-10 text-ui text-muted-foreground">No apps match “{search.trim()}”.</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              {(q ? matching : shown).map((card) => (
                <GridItem
                  key={card.slug}
                  tile={
                    <Tile>
                      <ServiceIcon card={card} />
                    </Tile>
                  }
                  name={card.label}
                  line={card.blurb}
                  onOpen={() => openApp(card)}
                  action={status[card.slug]?.connected ? manageAction(card) : connectAction(card)}
                />
              ))}
            </div>
          )}
          {!q && !unfolded && <MoreLine hidden={notConnected.slice(FOLD).map((c) => c.label)} onClick={() => setUnfolded(true)} />}
        </>
      )}

      <AddMcpServerDialog
        open={addingServer}
        onOpenChange={setAddingServer}
        onAdded={(id) => {
          reloadServers();
          // a server is only useful once an agent may use it, which is chosen on its page
          dispatch({ type: "openPluginSettings", focus: { kind: "mcp", id } });
        }}
      />
      <AddSkillDialog
        open={addingSkill}
        onOpenChange={setAddingSkill}
        onInstalled={(skill) => dispatch({ type: "openPluginSettings", focus: { kind: "skill", id: skill.id } })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function SkillsPage({
  search,
  setSearch,
  searchRef,
}: {
  search: string;
  setSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { dispatch } = useStore();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [updates, setUpdates] = useState(0);
  const [view, setView] = useState<"installed" | "catalog">("installed");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Skill | null>(null);
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api("/api/skills")
        .then((r) => setSkills(r.skills ?? []))
        .catch(() => setSkills([])),
      api("/api/skills/proposals")
        .then((r) => setProposals(r.proposals ?? []))
        .catch(() => setProposals([])),
      api("/api/skills/registry")
        .then((r) => setUpdates(r.updates ?? 0))
        .catch(() => setUpdates(0)),
    ]).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const matching = (skills ?? []).filter((s) => !q || `${s.name} ${s.description} ${s.body}`.toLowerCase().includes(q));
  const groups = [
    { key: "user", title: "Yours", rows: matching.filter((s) => s.source === "user") },
    { key: "builtin", title: "Built in", rows: matching.filter((s) => s.source === "builtin") },
  ].filter((g) => g.rows.length > 0);

  const remove = (skill: Skill) => {
    if (!window.confirm(`Remove ${skill.name}? Agents it is attached to stop using it.`)) return;
    void api(`/api/skills/${skill.id}`, { method: "DELETE" })
      .then(() => setOpen(null))
      .then(load)
      .catch(() => {});
  };

  return (
    <>
      <PageHeader
        title="Skills"
        says="Reusable instructions your agents can pick up."
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        placeholder="Search skills"
        onRefresh={() => void load()}
        refreshing={loading}
        onSettings={() => dispatch({ type: "toggleAppSettings", open: true, page: "general" })}
        add={
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(pill, "gap-1 bg-foreground px-4 text-body font-medium text-background hover:opacity-90")}
            >
              Add
              <ChevronDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuItem onClick={() => setAdding(true)}>
                <Plus />
                Write or import a skill
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setView("catalog")}>
                <Sparkles />
                Browse the catalogue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Pills
        value={view}
        onChange={setView}
        options={[
          { value: "installed", label: "On this machine" },
          {
            value: "catalog",
            label: (
              <>
                Catalogue
                {updates > 0 && (
                  <span className="rounded-full bg-brand/15 px-1.5 text-caption font-semibold tabular-nums text-brand-ink">{updates}</span>
                )}
              </>
            ),
          },
        ]}
      />

      {view === "catalog" ? (
        <div className="mt-6 flex min-h-[420px] flex-col">
          <SkillCatalog onInstalled={() => void load()} />
        </div>
      ) : (
        <>
          {proposals.length > 0 && !q && (
            <>
              <SectionTitle>Suggested from your conversations</SectionTitle>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {proposals.map((proposal) => (
                  <ProposedSkill key={proposal.id} proposal={proposal} onDone={() => void load()} />
                ))}
              </div>
            </>
          )}

          {skills === null ? (
            <div className="mt-10 flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading skills
            </div>
          ) : groups.length === 0 ? (
            <p className="mt-10 text-ui text-muted-foreground">
              {q ? `No skills match “${search.trim()}”.` : "No skills yet. Add one, or browse the catalogue."}
            </p>
          ) : (
            groups.map((group) => {
              const all = unfolded[group.key] || Boolean(q);
              const rows = all ? group.rows : group.rows.slice(0, 6);
              return (
                <section key={group.key}>
                  <SectionTitle
                    aside={<span className="text-body tabular-nums text-muted-foreground">{group.rows.length}</span>}
                  >
                    {group.title}
                  </SectionTitle>
                  <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                    {rows.map((skill) => (
                      <GridItem
                        key={skill.id}
                        onOpen={() => setOpen(skill)}
                        tile={<Tile>{skill.source === "builtin" ? <Lock size={16} /> : <Sparkles size={17} />}</Tile>}
                        name={skill.name}
                        line={skill.description}
                        action={<Check size={16} className="mr-2 text-muted-foreground" aria-label="Installed" />}
                      />
                    ))}
                  </div>
                  {!all && (
                    <MoreLine
                      hidden={group.rows.slice(6).map((s) => s.name)}
                      onClick={() => setUnfolded((u) => ({ ...u, [group.key]: true }))}
                    />
                  )}
                </section>
              );
            })
          )}
          <p className="mt-10 text-body text-muted-foreground">
            Attach a skill to an agent from that agent's settings. Skills live in{" "}
            <code className="rounded bg-muted px-1 py-px font-mono text-small">~/.bloks/skills</code>.
          </p>
        </>
      )}

      <AddSkillDialog open={adding} onOpenChange={setAdding} onInstalled={() => void load()} />

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="flex max-h-[84vh] max-w-[680px] flex-col">
          {open && (
            <>
              <DialogTitle className="pr-8">{open.name}</DialogTitle>
              {open.description && <DialogDescription>{open.description}</DialogDescription>}
              <pre className="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-3.5 font-mono text-small leading-relaxed text-foreground">
                {open.body}
              </pre>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-body text-muted-foreground">
                  {open.source === "builtin" ? "Built in, part of Bloks." : "Yours, on this machine."}
                </span>
                {open.source === "user" && (
                  <button
                    onClick={() => remove(open)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body text-destructive transition-colors duration-150 hover:bg-destructive/10"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function NavRow({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-ui outline-none transition-colors duration-150",
        active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** The Customize sidebar: the two pages, then the apps already connected. */
function CustomizeSidebar({
  tab,
  setTab,
  installed,
  onPickApp,
  onSearch,
}: {
  tab: CustomizeTab;
  setTab: (tab: CustomizeTab) => void;
  installed: ToolkitCard[];
  onPickApp: (card: ToolkitCard) => void;
  onSearch: () => void;
}) {
  return (
    <aside aria-label="Customize" className="hidden h-full w-[264px] shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="titlebar-drag flex h-[52px] shrink-0 items-center justify-between pl-4 pr-2.5">
        <span className="text-lead font-semibold text-foreground">Customize</span>
        <button
          onClick={onSearch}
          aria-label={tab === "plugins" ? "Search plugins" : "Search skills"}
          title="Search"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
        >
          <Search size={16} />
        </button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <NavRow active={tab === "plugins"} icon={<Puzzle size={17} />} label="Plugins" onClick={() => setTab("plugins")} />
        <NavRow active={tab === "skills"} icon={<Sparkles size={17} />} label="Skills" onClick={() => setTab("skills")} />
      </nav>
      <div className="mt-6 px-4 pb-1.5 text-body text-muted-foreground">Installed</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {installed.length === 0 ? (
          <p className="px-2.5 text-body leading-relaxed text-muted-foreground/80">Apps you connect show up here.</p>
        ) : (
          installed.map((card) => (
            <NavRow key={card.slug} active={false} icon={<ServiceIcon card={card} size={16} />} label={card.label} onClick={() => onPickApp(card)} />
          ))
        )}
      </div>
    </aside>
  );
}

/** The whole Customize place: its sidebar and the page it has open. */
export function CustomizeView() {
  const { state, dispatch } = useStore();
  const tab = state.customize;
  const setTab = (next: CustomizeTab) => dispatch({ type: "openCustomize", tab: next });
  const connectors = useConnectors();
  const [pluginSearch, setPluginSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);
  const installed = useMemo(() => connectors.installed, [connectors.installed]);

  return (
    <>
      <CustomizeSidebar
        tab={tab}
        setTab={setTab}
        installed={installed}
        onSearch={() => searchRef.current?.focus()}
        onPickApp={(card) => {
          setTab("plugins");
          setPluginSearch(card.label);
        }}
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="titlebar-drag h-3 shrink-0" />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1080px] px-6 pb-20 pt-7 max-md:pt-16 lg:px-12">
            {/* the sidebar does not fit on a phone; the two pages are a
                switch at the top instead */}
            <div className="mb-5 md:hidden">
              <Pills
                value={tab}
                onChange={setTab}
                options={[
                  { value: "plugins", label: "Plugins" },
                  { value: "skills", label: "Skills" },
                ]}
              />
            </div>
            {tab === "plugins" && state.customizeApp ? (
              <AppDetailsPage slug={state.customizeApp} connectors={connectors} />
            ) : tab === "plugins" ? (
              <PluginsPage connectors={connectors} search={pluginSearch} setSearch={setPluginSearch} searchRef={searchRef} />
            ) : (
              <SkillsPage search={skillSearch} setSearch={setSkillSearch} searchRef={searchRef} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
