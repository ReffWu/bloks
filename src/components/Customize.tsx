// Customize: what your agents can reach and what they know how to do, as
// a place of its own off the main rail. A sidebar of its own lists the
// pages and the apps already connected; each page is a catalogue laid out
// to read, two to a row, with the one action each item needs beside it.
// The sidebar is a page column (SideColumn.tsx), sized by its edge and
// folded with ⌘B, and folded the pages are a switch at the top left of
// the page.
//
// Plugins are the connected apps (Composio Connect) and the interfaces MCP
// servers draw; Skills are the instructions agents pick up, the ones on
// this machine; Catalogue is ready teams and skills to install
// (CatalogPage.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Lock } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { MoreHorizontal } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Puzzle } from "@/components/icons";
import { Download } from "@/components/icons";
import { LayoutGrid } from "@/components/icons";
import { Search } from "@/components/icons";
import { Settings } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore, type CustomizeTab, type Skill } from "@/state/store";
import { useConnectors, type Connectors, type ToolkitCard } from "@/lib/useConnectors";
import { McpAppsCard } from "./McpApps";
import { AddMcpServerDialog, useMcpServers } from "./McpServers";
import { AppDetailsPage } from "./AppDetails";
import { ComposioKeyDialog } from "./ComposioKeyDialog";
import { detailsFor } from "@/lib/appDetails";
import { tryPrompt } from "@/lib/tryPrompt";
import { CatalogPage, openCatalog } from "./CatalogPage";
import { AddSkillDialog, ProposedSkill, type Proposal } from "./SkillsPanel";
import { SkillDetail, usageWords } from "./SkillVersions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useColumnFolded, type SideColumnSize } from "@/lib/sideColumn";
import { FoldedSwitchBar, FoldedSwitchSlot, SideColumn, SideSwitch } from "./SideColumn";
import { shareAsFile } from "@/lib/shareFile";
import { GridItem, GridSkeleton, MoreLine, PageHeader, pill, Pills, ROUND, SectionTitle, Tile } from "./CustomizeParts";

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
  const { ordered, installed, configured, source, status, busySlug, refreshing, error, refreshStatus, connect, disconnect, statusRef, cards, askForKey } =
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
    if (!bot) setTried("No agent can use apps yet. Turn it on in an agent's settings.");
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
      <button onClick={() => connect(card.slug)} aria-label={`Connect ${card.label}`} title={`Connect ${card.label}`} className={ROUND}>
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
        says="Connect apps your agents can use."
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
                Add a Composio key to connect apps.
                <span className="text-muted-foreground"> One key works for every agent.</span>
              </span>
              <button
                onClick={() => askForKey()}
                className={cn(pill, "h-8 bg-foreground px-3.5 text-body font-medium text-background hover:opacity-90")}
              >
                Add a key
              </button>
            </div>
          )}
          {configured && source === "curated" && (
            <p className="mt-5 text-body text-muted-foreground">
              Showing popular apps.{" "}
              <button onClick={toKeys} className="underline underline-offset-2 hover:text-foreground">
                Add a Composio API key
              </button>{" "}
              to see them all.
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
            <GridSkeleton label="Loading the catalogue" count={8} />
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
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Skill | null>(null);
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api("/api/skills")
        .then((r) => {
          const all: Skill[] = r.skills ?? [];
          setSkills(all);
          // the skill open in the window follows its new version
          setOpen((was) => (was ? (all.find((s) => s.id === was.id) ?? was) : was));
        })
        .catch(() => setSkills([])),
      api("/api/skills/proposals")
        .then((r) => setProposals(r.proposals ?? []))
        .catch(() => setProposals([])),
      // the catalogue's updates for skills here, said on this page too
      api("/api/catalog")
        .then((r) => setUpdates((r.items ?? []).filter((i: { kind: string; standing: { state: string } }) => i.kind === "skill" && i.standing.state === "outdated").length))
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

  const remove = async (skill: Skill) => {
    const yes = await confirm({
      title: `Remove ${skill.name}?`,
      body: "Agents will stop using it.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!yes) return;
    void api(`/api/skills/${skill.id}`, { method: "DELETE" })
      .then(() => {
        setOpen(null);
        toast(`Removed ${skill.name}`);
      })
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
              <DropdownMenuItem onClick={() => openCatalog(dispatch, "skill")}>
                <Sparkles />
                Browse the catalogue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {updates > 0 && !q && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
          <span className="text-ui text-foreground">
            {updates === 1 ? "A skill you installed has an update" : `${updates} skills you installed have updates`} in the catalogue.
          </span>
          <button
            onClick={() => openCatalog(dispatch, "skill")}
            className={cn(pill, "h-8 bg-foreground px-3.5 text-body font-medium text-background hover:opacity-90")}
          >
            Review
          </button>
        </div>
      )}

          {proposals.length > 0 && !q && (
            <>
              <SectionTitle>Suggested from your chats</SectionTitle>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {proposals.map((proposal) => (
                  <ProposedSkill key={proposal.id} proposal={proposal} onDone={() => void load()} />
                ))}
              </div>
            </>
          )}

          {skills === null ? (
            <GridSkeleton label="Loading skills" className="mt-6" />
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
                        action={
                          skill.uses ? (
                            // which skills pull their weight: how often, and
                            // amber when most uses were corrected straight after
                            <span
                              title={usageWords(skill.uses, skill.corrected ?? 0, skill.lastUsed ?? null)}
                              aria-label={usageWords(skill.uses, skill.corrected ?? 0, skill.lastUsed ?? null)}
                              className={cn(
                                "mr-2 text-small tabular-nums",
                                skill.uses >= 2 && (skill.corrected ?? 0) * 2 >= skill.uses ? "text-warning" : "text-muted-foreground",
                              )}
                            >
                              {skill.uses} {skill.uses === 1 ? "use" : "uses"}
                            </span>
                          ) : (
                            <Check size={16} className="mr-2 text-muted-foreground" aria-label="Installed" />
                          )
                        }
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
            Attach skills in an agent's settings. Stored in{" "}
            <code className="rounded bg-muted px-1 py-px font-mono text-small">~/.bloks/skills</code>.
          </p>

      <AddSkillDialog open={adding} onOpenChange={setAdding} onInstalled={() => void load()} />

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="flex max-h-[88vh] max-w-[820px] flex-col">
          {open && (
            <>
              <DialogTitle className="pr-8">{open.name}</DialogTitle>
              {open.description && <DialogDescription>{open.description}</DialogDescription>}
              <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-auto">
                <SkillDetail
                  skill={open}
                  onChanged={(next) => {
                    if (next) setOpen((was) => (was ? { ...was, ...next } : was));
                    void load();
                  }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-body text-muted-foreground">
                  {open.source === "builtin" ? "Built in" : "Yours"}
                </span>
                <div className="flex items-center gap-1">
                  {/* the catalogue's SKILL.md, keys and addresses taken out */}
                  <button
                    onClick={() =>
                      shareAsFile(`/api/skills/${open.id}/skill.md`, "SKILL.md")
                        .then(() => toast("Saved SKILL.md", { description: `For the catalogue, it goes in catalog/skills/${open.id}/.` }))
                        .catch((e: Error) => toast.error(e.message))
                    }
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                  >
                    <Download size={14} />
                    Share as file
                  </button>
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
    <SideColumn id="plugins" size={CUSTOMIZE_COLUMN} label="Customize" className="hidden h-full bg-sidebar md:flex">
      <div className="titlebar-drag flex h-[52px] shrink-0 items-center justify-between pl-4 pr-2.5">
        <span className="text-lead font-semibold text-foreground">Customize</span>
        <button
          onClick={onSearch}
          aria-label={tab === "plugins" ? "Search plugins" : tab === "skills" ? "Search skills" : "Search the catalogue"}
          title="Search"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
        >
          <Search size={16} />
        </button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <NavRow active={tab === "plugins"} icon={<Puzzle size={17} />} label="Plugins" onClick={() => setTab("plugins")} />
        <NavRow active={tab === "skills"} icon={<Sparkles size={17} />} label="Skills" onClick={() => setTab("skills")} />
        <NavRow active={tab === "catalog"} icon={<LayoutGrid size={17} />} label="Catalogue" onClick={() => setTab("catalog")} />
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
    </SideColumn>
  );
}

/** The sidebar's sizes: at its narrowest, an app's name still reads. */
const CUSTOMIZE_COLUMN: SideColumnSize = { min: 200, max: 400, initial: 264, foldBelow: 150 };

/** The whole Customize place: its sidebar and the page it has open. */
export function CustomizeView() {
  const { state, dispatch } = useStore();
  const tab = state.customize;
  const setTab = (next: CustomizeTab) => dispatch({ type: "openCustomize", tab: next });
  // Folded, the sidebar's two pages are a switch at the top left of the
  // page (FoldedSwitchBar); the apps it lists are the Plugins page's own.
  const folded = useColumnFolded("plugins", CUSTOMIZE_COLUMN);
  const connectors = useConnectors();
  const [pluginSearch, setPluginSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
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
                  { value: "catalog", label: "Catalogue" },
                ]}
              />
            </div>
            <FoldedSwitchSlot
              value={
                folded ? (
                  <SideSwitch
                    column="plugins"
                    label="Customize"
                    current={tab}
                    onPick={(id) => setTab(id as CustomizeTab)}
                    items={[
                      { id: "plugins", label: "Plugins", icon: <Puzzle size={14} /> },
                      { id: "skills", label: "Skills", icon: <Sparkles size={14} /> },
                      { id: "catalog", label: "Catalogue", icon: <LayoutGrid size={14} /> },
                    ]}
                  />
                ) : null
              }
            >
              <FoldedSwitchBar />
              {tab === "plugins" && state.customizeApp ? (
                <AppDetailsPage slug={state.customizeApp} connectors={connectors} />
              ) : tab === "plugins" ? (
                <PluginsPage connectors={connectors} search={pluginSearch} setSearch={setPluginSearch} searchRef={searchRef} />
              ) : tab === "catalog" ? (
                <CatalogPage search={catalogSearch} setSearch={setCatalogSearch} searchRef={searchRef} />
              ) : (
                <SkillsPage search={skillSearch} setSearch={setSkillSearch} searchRef={searchRef} />
              )}
            </FoldedSwitchSlot>
          </div>
        </div>
      </main>
      <ComposioKeyDialog connectors={connectors} />
    </>
  );
}
