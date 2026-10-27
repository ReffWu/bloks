// Customize's Catalogue: ready teams and skills, browsed, read and
// installed after a review (CatalogReview.tsx). Teams and Skills are its
// two tabs, with search and tags across both.
//
// The catalogue lives in Bloks's own repository (catalog/), read through
// the server, which checks every file against the index's fingerprint
// and keeps a copy, so the page still opens offline and says how old its
// copy is. "Install from a link" takes a raw GitHub address or any https
// link to a team or a SKILL.md, or a file from this computer, and
// bloks://install links land here too; all of them end in the same
// review, and nothing is installed until Install is pressed there.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "@/components/icons";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Info } from "@/components/icons";
import { Crown } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { FileText } from "@/components/icons";
import { Globe } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { TriangleAlert } from "@/components/icons";
import { Upload } from "@/components/icons";
import { Users } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { BlokAvatar } from "./Avatar";
import { CatalogReview } from "./CatalogReview";
import { Markdownish } from "./Markdown";
import { GridItem, GridSkeleton, PageHeader, pill, Pills, ROUND, SectionTitle, Tile } from "./CustomizeParts";
import {
  fetchedWords,
  filterCatalog,
  tagsOf,
  updatesOf,
  type CatalogAnswer,
  type CatalogKind,
  type CatalogRow,
  type Review,
  type SkillFile,
  type TeamFile,
} from "@/lib/catalog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/plural";

/** Where contributors are pointed, from the page's footer. */
const GUIDE_URL = "https://github.com/hamedgitty/bloks/blob/main/catalog/README.md";
const KIND_KEY = "bloks.catalog.kind";

/** Opens the Catalogue on one of its tabs, from anywhere in the app. */
export function openCatalog(dispatch: ReturnType<typeof useStore>["dispatch"], kind: CatalogKind) {
  try {
    localStorage.setItem(KIND_KEY, kind);
  } catch {
    /* opens on whichever tab it was on */
  }
  dispatch({ type: "openCustomize", tab: "catalog" });
}

function readKind(): CatalogKind {
  try {
    return localStorage.getItem(KIND_KEY) === "skill" ? "skill" : "team";
  } catch {
    return "team";
  }
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function when(days: number[], time: string): string {
  const same = (list: number[]) => days.length === list.length && days.every((d, i) => d === list[i]);
  if (!days.length) return `Every day at ${time}`;
  if (same([1, 2, 3, 4, 5])) return `Weekdays at ${time}`;
  if (same([0, 6])) return `Weekends at ${time}`;
  return `${days.map((d) => DAY[d]).join(", ")} at ${time}`;
}

export function CatalogPage({
  search,
  setSearch,
  searchRef,
}: {
  search: string;
  setSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { state, dispatch } = useStore();
  const [data, setData] = useState<CatalogAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKindState] = useState<CatalogKind>(readKind);
  const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState<CatalogRow | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState<{ url?: string; error?: string } | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setKind = (next: CatalogKind) => {
    setKindState(next);
    setTags([]);
    try {
      localStorage.setItem(KIND_KEY, next);
    } catch {
      /* remembered for this visit only */
    }
  };

  const load = useCallback((refresh = false) => {
    setLoading(true);
    return api(`/api/catalog${refresh ? "?refresh=1" : ""}`)
      .then((answer: CatalogAnswer) => {
        setData(answer);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Asks the server what an install would do, and opens the review. */
  const startReview = useCallback(
    (body: Record<string, unknown>, busyKey: string) => {
      setReviewing(busyKey);
      return api("/api/catalog/review", { method: "POST", body: JSON.stringify(body) })
        .then(({ review: next }: { review: Review }) => {
          setReview(next);
          return true;
        })
        .finally(() => setReviewing(null));
    },
    [],
  );
  const reviewItem = (item: CatalogRow) => startReview({ kind: item.kind, id: item.id }, `${item.kind}:${item.id}`).catch((e: Error) => setError(e.message));

  // a bloks://install link, from the website or anywhere else
  useEffect(() => {
    const url = state.installLink;
    if (!url) return;
    dispatch({ type: "openInstallLink", url: null });
    setLinkOpen(null);
    startReview({ url }, "link").catch((e: Error) => setLinkOpen({ url, error: e.message }));
  }, [state.installLink, dispatch, startReview]);

  const readFile = (file: File) => {
    file
      .text()
      .then((text) => startReview({ text, filename: file.name }, "file"))
      .then(() => setLinkOpen(null))
      .catch((e: Error) => setLinkOpen((prev) => ({ ...(prev ?? {}), error: e.message })));
  };

  const items = data?.items ?? [];
  const matching = useMemo(() => filterCatalog(items, kind, search, tags), [items, kind, search, tags]);
  const kindTags = useMemo(() => tagsOf(items, kind), [items, kind]);
  const teamUpdates = updatesOf(items, "team");
  const skillUpdates = updatesOf(items, "skill");
  const host = data ? new URL(data.source.url).host : "";

  const action = (item: CatalogRow) => {
    const busy = reviewing === `${item.kind}:${item.id}`;
    if (busy) {
      return (
        <span className={ROUND}>
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
        </span>
      );
    }
    const s = item.standing;
    if (!s.action) return <Check size={16} className="mr-2 text-muted-foreground" aria-label="Installed" />;
    if (s.state === "available") {
      return (
        <button onClick={() => void reviewItem(item)} aria-label={`Install ${item.title}`} title={`Install ${item.title}`} className={ROUND}>
          <Plus size={17} />
        </button>
      );
    }
    return (
      <button
        onClick={() => void reviewItem(item)}
        title={s.says}
        className={cn(
          "flex h-8 items-center gap-1 rounded-full px-3 text-body font-medium outline-none transition-colors duration-150",
          s.destructive ? "text-warning hover:bg-warning/10" : "bg-brand/15 text-brand-ink hover:bg-brand/25",
        )}
      >
        {s.destructive && <TriangleAlert size={13} />}
        {s.action}
      </button>
    );
  };

  const lineFor = (item: CatalogRow) => {
    if (data?.offline && !item.offline) return "Needs a connection to install";
    if (item.standing.state === "available" || item.standing.state === "current") return item.summary;
    return item.standing.says;
  };

  const header = (
    <PageHeader
      title="Catalogue"
      says="Ready teams and skills. Each is reviewed with you before anything is installed."
      search={search}
      onSearch={setSearch}
      searchRef={searchRef}
      placeholder="Search the catalogue"
      onRefresh={() => void load(true)}
      refreshing={loading}
      onSettings={() => setSourceOpen(true)}
      add={
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(pill, "gap-1 bg-foreground px-4 text-body font-medium text-background hover:opacity-90")}>
            Install
            <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItem onClick={() => setLinkOpen({})}>
              <Globe />
              From a link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileRef.current?.click()}>
              <Upload />
              From a file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );

  const dialogs = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.json,text/markdown,text/plain,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) readFile(file);
        }}
      />
      {review && (
        <CatalogReview
          review={review}
          onClose={() => setReview(null)}
          onInstalled={() => {
            setOpen(null);
            void load();
          }}
        />
      )}
      {linkOpen && (
        <InstallFromLink
          initial={linkOpen}
          busy={reviewing === "link" || reviewing === "file"}
          onClose={() => setLinkOpen(null)}
          onReview={(url) => startReview({ url }, "link").then(() => setLinkOpen(null)).catch((e: Error) => setLinkOpen({ url, error: e.message }))}
          onFile={() => fileRef.current?.click()}
        />
      )}
      {sourceOpen && <SourceDialog onClose={() => setSourceOpen(false)} onChanged={() => void load(true)} />}
    </>
  );

  if (open) {
    return (
      <>
        <ItemPage
          row={items.find((i) => i.kind === open.kind && i.id === open.id) ?? open}
          skillTitles={new Map(items.filter((i) => i.kind === "skill").map((i) => [i.id, i.title]))}
          busy={reviewing === `${open.kind}:${open.id}`}
          onBack={() => setOpen(null)}
          onInstall={(item) => void reviewItem(item)}
        />
        {dialogs}
      </>
    );
  }

  return (
    <>
      {header}

      <Pills
        value={kind}
        onChange={setKind}
        options={[
          {
            value: "team",
            label: (
              <>
                Teams
                {teamUpdates > 0 && <span className="rounded-full bg-brand/15 px-1.5 text-caption font-semibold tabular-nums text-brand-ink">{teamUpdates}</span>}
              </>
            ),
          },
          {
            value: "skill",
            label: (
              <>
                Skills
                {skillUpdates > 0 && <span className="rounded-full bg-brand/15 px-1.5 text-caption font-semibold tabular-nums text-brand-ink">{skillUpdates}</span>}
              </>
            ),
          },
        ]}
      />

      {kindTags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          {kindTags.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                aria-pressed={on}
                onClick={() => setTags((prev) => (on ? prev.filter((t) => t !== tag) : [...prev, tag]))}
                className={cn(
                  "h-7 rounded-full border px-3 text-small transition-colors duration-150",
                  on ? "border-foreground/20 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {data?.offline && (
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border bg-card px-4 py-3">
          <Info size={15} className="mt-[3px] shrink-0 text-muted-foreground" />
          <p className="text-body text-foreground">
            Offline. Showing the catalogue as of {fetchedWords(data.fetchedAt)}.
            <span className="text-muted-foreground"> Items kept on this computer still install.</span>
          </p>
        </div>
      )}
      {error && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-destructive/10 px-4 py-3">
          <span className="text-body text-destructive">{error}</span>
          {!data && (
            <Button variant="secondary" size="sm" onClick={() => void load(true)}>
              Try again
            </Button>
          )}
        </div>
      )}

      <SectionTitle
        aside={data && <span className="text-body tabular-nums text-muted-foreground">{search || tags.length ? `${matching.length} found` : plural(matching.length, kind === "team" ? "team" : "skill")}</span>}
      >
        {search || tags.length ? "Results" : kind === "team" ? "Teams" : "Skills"}
      </SectionTitle>
      {data === null && !error ? (
        <GridSkeleton label="Loading the catalogue" count={8} />
      ) : data && matching.length === 0 ? (
        <p className="py-10 text-ui text-muted-foreground">
          {search || tags.length ? `Nothing matches${search ? ` “${search.trim()}”` : " those tags"}.` : `The catalogue has no ${kind === "team" ? "teams" : "skills"} yet.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          {matching.map((item) => (
            <GridItem
              key={`${item.kind}:${item.id}`}
              onOpen={() => setOpen(item)}
              tile={<Tile>{item.kind === "team" ? <Users size={17} /> : <Sparkles size={17} />}</Tile>}
              name={item.title}
              line={lineFor(item)}
              action={action(item)}
            />
          ))}
        </div>
      )}

      {data && (
        <p className="mt-10 text-body leading-relaxed text-muted-foreground">
          From {host}
          {data.source.custom ? ", a catalogue you chose" : ""}. Anyone can add a team or a skill by pull request:{" "}
          <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
            how to contribute
            <ExternalLink size={12} />
          </a>
          .
        </p>
      )}
      {dialogs}
    </>
  );
}

// ---------------------------------------------------------------------------

/** One item's own page: what it is, in full, and the one action. */
function ItemPage({
  row,
  skillTitles,
  busy,
  onBack,
  onInstall,
}: {
  row: CatalogRow;
  /** The catalogue's skills by id, to name the ones a team uses. */
  skillTitles: Map<string, string>;
  busy: boolean;
  onBack: () => void;
  onInstall: (item: CatalogRow) => void;
}) {
  const [detail, setDetail] = useState<{ text: string; team?: TeamFile; skill?: SkillFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    setDetail(null);
    setError(null);
    api(`/api/catalog/${row.kind}/${row.id}`)
      .then((r) => setDetail(r))
      .catch((e: Error) => setError(e.message));
  }, [row.kind, row.id]);

  const s = row.standing;
  const meta = [`Version ${row.version}`, row.author ? `by ${row.author}` : "", row.tags.join(", ")].filter(Boolean).join(" · ");

  return (
    <>
      <button
        onClick={onBack}
        className="-ml-1 mb-5 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-body text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft size={15} />
        Catalogue
      </button>
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {row.kind === "team" ? <Users size={24} /> : <Sparkles size={24} />}
          </span>
          <div className="min-w-0">
            <h1 className="text-balance text-display font-semibold text-foreground">{row.title}</h1>
            <p className="mt-1 text-pretty text-ui text-muted-foreground">{row.summary}</p>
            <p className="mt-1.5 text-body text-muted-foreground">{meta}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.action ? (
            <Button
              size="lg"
              variant={s.destructive ? "outline" : "default"}
              disabled={busy}
              onClick={() => onInstall(row)}
              className={cn(s.destructive && "text-warning hover:text-warning")}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : s.destructive ? <TriangleAlert size={14} /> : null}
              {s.action === "Install" ? "Review and install" : `Review and ${s.action.toLowerCase()}`}
            </Button>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-body text-muted-foreground">
                <Check size={15} />
                Installed
              </span>
              {row.kind === "team" && (
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => onInstall(row)}>
                  Install again
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {s.state !== "available" && s.state !== "current" && (
        <div className={cn("mt-6 flex gap-2 rounded-xl px-3.5 py-2.5 text-body leading-relaxed", s.destructive ? "bg-warning/10 text-warning" : "bg-muted/60 text-foreground")}>
          {s.destructive && <TriangleAlert size={14} className="mt-[3px] shrink-0" />}
          <span>{s.says}.</span>
        </div>
      )}

      {error && <p className="mt-6 text-body text-destructive">{error}</p>}
      {!detail && !error && (
        <div className="mt-10 flex items-center gap-2 text-body text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading
        </div>
      )}

      {detail?.team && !raw && <TeamDetail team={detail.team} skillTitles={skillTitles} />}
      {detail?.skill && !raw && (
        <>
          <SectionTitle>Instructions</SectionTitle>
          <div className="mt-3 max-w-[760px] text-ui leading-relaxed">
            <Markdownish text={detail.skill.body} />
          </div>
        </>
      )}
      {detail && raw && (
        <>
          <SectionTitle>The file</SectionTitle>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-4 font-mono text-small leading-relaxed text-foreground">{detail.text}</pre>
        </>
      )}
      {detail && (
        <button
          onClick={() => setRaw((v) => !v)}
          className="mt-8 flex items-center gap-1.5 text-body text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline"
        >
          <FileText size={14} />
          {raw ? "Show it laid out" : "Show the file"}
        </button>
      )}
    </>
  );
}

function TeamDetail({ team, skillTitles }: { team: TeamFile; skillTitles: Map<string, string> }) {
  const routines = [
    ...(team.routines ?? []).map((r) => ({ ...r, target: "The room" })),
    ...team.members.flatMap((m) => (m.routines ?? []).map((r) => ({ ...r, target: m.title }))),
  ];
  return (
    <>
      <SectionTitle aside={<span className="text-body tabular-nums text-muted-foreground">{team.members.length}</span>}>Members</SectionTitle>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {team.members.map((member, i) => (
          <article key={i} className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <BlokAvatar color={member.color} shape={member.shape} size={34} />
              <h3 className="flex min-w-0 items-center gap-1.5 text-ui font-semibold text-foreground">
                <span className="truncate">{member.title}</span>
                {member.seniority === 5 && <Crown size={12} className="shrink-0 text-brand-ink" aria-label="Leads" />}
              </h3>
            </div>
            <p className="mt-2.5 whitespace-pre-line text-body leading-relaxed text-foreground/90">{member.description}</p>
            {member.skills.length > 0 && (
              <ul className="mt-2.5 flex list-disc flex-col gap-1 pl-4 text-body text-muted-foreground">
                {member.skills.map((skill, j) => (
                  <li key={j}>{skill}</li>
                ))}
              </ul>
            )}
            {(member.uses ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {member.uses!.map((id) => (
                  <span key={id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-small text-muted-foreground">
                    <Sparkles size={11} />
                    {skillTitles.get(id) ?? id}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      {routines.length > 0 && (
        <>
          <SectionTitle aside={<span className="text-body text-muted-foreground">Start paused</span>}>Routines</SectionTitle>
          <div className="mt-2 flex flex-col">
            {routines.map((r, i) => (
              <div key={i} className={cn("flex flex-col gap-0.5 py-3", i > 0 && "border-t")}>
                <span className="text-ui font-medium text-foreground">
                  {r.name ?? when(r.days, r.time)}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {r.name ? `${when(r.days, r.time)}, ` : ""}
                    {r.target === "The room" ? "to the room" : `for the ${r.target}`}
                  </span>
                </span>
                <span className="text-body text-muted-foreground">{r.prompt}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/** A link or a file to review, from anywhere. */
function InstallFromLink({
  initial,
  busy,
  onClose,
  onReview,
  onFile,
}: {
  initial: { url?: string; error?: string };
  busy: boolean;
  onClose: () => void;
  onReview: (url: string) => void;
  onFile: () => void;
}) {
  const [url, setUrl] = useState(initial.url ?? "");
  useEffect(() => setUrl(initial.url ?? ""), [initial.url]);
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Install from a link</DialogTitle>
        <DialogDescription>
          A team's .md file or a skill's SKILL.md, on https. A GitHub page for the file works too. You will see what it installs first.
        </DialogDescription>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !busy) onReview(url.trim());
          }}
        >
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/…/SKILL.md"
            aria-label="Link to a team or a skill"
            inputMode="url"
            spellCheck={false}
          />
          {initial.error && <p className="mt-2 text-small text-destructive">{initial.error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={onFile} disabled={busy}>
              <Upload size={14} />
              Choose a file instead
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!url.trim() || busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : "Review"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Where the catalogue comes from: Bloks's own, or one somebody keeps. */
function SourceDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [source, setSource] = useState<{ url: string; default: string; fromEnvironment: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api("/api/catalog/source")
      .then((r) => {
        setSource(r);
        setUrl(r.url === r.default ? "" : r.url);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const save = (next: string) => {
    setSaving(true);
    setError(null);
    api("/api/catalog/source", { method: "PUT", body: JSON.stringify({ url: next }) })
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Catalogue source</DialogTitle>
        <DialogDescription>
          The Bloks catalogue is read from its repository on GitHub. Point at another catalogue's index.json to use one you or your team keep.
        </DialogDescription>
        {source?.fromEnvironment ? (
          <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2.5 text-body text-foreground">
            Set by BLOKS_CATALOG_URL for this run: <span className="break-all font-mono text-small">{source.url}</span>
          </p>
        ) : (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              save(url.trim());
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={source?.default ?? "https://…/index.json"}
              aria-label="Catalogue index address"
              spellCheck={false}
            />
            {error && <p className="mt-2 text-small text-destructive">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" disabled={saving || !source || source.url === source.default} onClick={() => save("")}>
                Use the Bloks catalogue
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !source}>
                  Save
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
