// The main rail's full pages that are not Chat, Automations or Settings:
// Overview, Memory (MemoryPlace.tsx) and Plugins (Customize.tsx, with
// skills). Each shows what it holds in place, laid out as a page, rather
// than opening windows over the chat.
import { type RailPage } from "@/state/store";
import { RehearsalsPanel } from "./RehearsalsPanel";
import { CustomizeView } from "./Customize";
import { MemoryPlace } from "./MemoryPlace";
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
 * window they stack, brief first. Rehearsals, work waiting on a decision
 * like the rest, run the whole width below, where attempts side by side
 * have room to sit side by side.
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
          <header className="mb-10">
            <p className="text-body text-muted-foreground">{today}</p>
            <h1 className="mt-1 text-balance text-display font-semibold text-foreground">{greeting()}</h1>
            <p className="mt-2 text-pretty text-ui text-muted-foreground">
              {now.length ? `${now.join(", ")}.` : "Nothing running or waiting."}
            </p>
          </header>
          <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <BriefPanel />
            <div className="flex min-w-0 flex-col gap-8">
              <ActivityPanel />
              <ProjectsPanel />
            </div>
          </div>
          <div className="mt-8">
            <RehearsalsPanel />
          </div>
        </div>
      </div>
    </main>
  );
}

export function RailPageView({ page }: { page: RailPage }) {
  if (page === "overview") return <OverviewPage />;
  if (page === "memory") return <MemoryPlace />;
  return <CustomizeView />;
}
