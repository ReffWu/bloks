// The main rail's full pages that are not Chat, Automations or Settings:
// Overview, Library and Plugins (Customize.tsx, with skills). Each shows
// what it holds in place, laid out as a page, rather than opening windows
// over the chat.
import { useStore, type LibraryShelf, type RailPage } from "@/state/store";
import { Segmented } from "@/components/ui/segmented";
import { MemoryPanel } from "./MemoryPanel";
import { RehearsalsPanel } from "./RehearsalsPanel";
import { CustomizeView } from "./Customize";
import { BriefPanel } from "./BriefPanel";
import { ActivityPanel } from "./Activity";
import { ProjectsPanel } from "./ProjectsPanel";
import { useActivityCount } from "@/lib/activityCount";

/** A greeting for the time of day, as the page is opened. */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Overview: one page for the whole picture rather than three windows to
 * open in turn. The morning brief, the widest read, takes the main column;
 * what is running or waiting, and the projects, sit beside it. On a narrow
 * window they stack, brief first.
 */
function OverviewPage() {
  const activity = useActivityCount();
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const now: string[] = [];
  if (activity.waiting > 0) now.push(`${activity.waiting} waiting on you`);
  if (activity.running > 0) now.push(`${activity.running} running`);
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-9 max-md:pt-16 lg:px-10">
          <header className="mb-8">
            <p className="text-[13px] text-muted-foreground">{today}</p>
            <h1 className="mt-1 text-balance text-[28px] font-semibold tracking-tight text-foreground">{greeting()}</h1>
            <p className="mt-1.5 text-pretty text-[14px] text-muted-foreground">
              {now.length ? `${now.join(", ")}.` : "Nothing is running and nothing is waiting on you."}
            </p>
          </header>
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <BriefPanel />
            <div className="flex min-w-0 flex-col gap-5">
              <ActivityPanel />
              <ProjectsPanel />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export function RailPageView({ page }: { page: RailPage }) {
  if (page === "overview") return <OverviewPage />;
  if (page === "library") return <LibraryPage />;
  return <CustomizeView />;
}

/** A full page's own heading, the same on each: a title and one line. */
function PageHeading({ title, says, children }: { title: string; says: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-balance text-[28px] font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-pretty text-[14px] text-muted-foreground">{says}</p>
      </div>
      {children}
    </header>
  );
}

function LibraryPage() {
  const { state, dispatch } = useStore();
  const shelf = state.library;
  const setShelf = (next: LibraryShelf) => dispatch({ type: "openLibrary", shelf: next });
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col px-6 pb-6 pt-9 max-md:pt-16 lg:px-10">
        <PageHeading title="Library" says="What your agents remember between conversations, and work they tried on a copy first.">
          <Segmented<LibraryShelf>
            aria-label="Library"
            value={shelf}
            onChange={setShelf}
            options={[
              { value: "memory", label: "Memory" },
              { value: "rehearsals", label: "Rehearsals" },
            ]}
          />
        </PageHeading>
        <div className="flex min-h-[520px] flex-1 flex-col">
          {shelf === "memory" ? <MemoryPanel /> : <RehearsalsPanel />}
        </div>
      </div>
    </main>
  );
}
