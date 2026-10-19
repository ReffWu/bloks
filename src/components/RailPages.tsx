// The main rail's full pages that are not Chat, Automations or Settings:
// Overview, Memory (MemoryPlace.tsx) and Plugins (Customize.tsx, with
// skills). Each shows what it holds in place, laid out as a page, rather
// than opening windows over the chat.
import { motion } from "motion/react";
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

/** The page settles in a beat at a time, top down, the way you read it:
 * the greeting, then the brief, then what sits beside it. Small enough
 * to be over before it is noticed; reduce motion keeps only the fade. */
const arrive = (order: number) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, delay: order * 0.04, ease: [0.23, 1, 0.32, 1] as const },
});

/**
 * Overview: one page for the whole picture rather than three windows to
 * open in turn. The morning brief, the widest read, takes the main column
 * and is kept to a reading width; what is running or waiting, and the
 * projects, sit beside it in a narrower one. On a narrow window they
 * stack, brief first. Rehearsals, work waiting on a decision like the
 * rest, run the whole width below, where attempts side by side have room
 * to sit side by side.
 *
 * Nothing on the page is boxed. Each panel is a heading and its contents,
 * and space and one hairline do the separating, so it reads as a page and
 * not as a grid of cards competing for the eye.
 */
function OverviewPage() {
  const activity = useActivityCount();
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const now: string[] = [];
  if (activity.waiting > 0) now.push(`${activity.waiting} waiting on you`);
  if (activity.failed > 0) now.push(`${activity.failed} failed and ${activity.failed === 1 ? "needs" : "need"} a look`);
  if (activity.running > 0) now.push(`${activity.running} running`);
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1160px] px-4 pb-20 pt-9 max-md:pt-16 sm:px-6 lg:px-10">
          <motion.header {...arrive(0)} className="mb-12">
            <p className="text-body text-muted-foreground">{today}</p>
            <h1 className="mt-1 text-balance text-display font-semibold text-foreground">{greeting()}</h1>
            <p className="mt-2 text-pretty text-ui text-muted-foreground">
              {now.length ? `${now.join(", ")}.` : "Nothing running or waiting."}
            </p>
          </motion.header>
          <div className="grid grid-cols-1 items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
            <motion.div {...arrive(1)} className="min-w-0">
              <BriefPanel />
            </motion.div>
            <motion.aside
              {...arrive(2)}
              className="flex min-w-0 flex-col gap-10 max-lg:border-t max-lg:pt-10"
            >
              <ActivityPanel />
              <div className="border-t pt-10">
                <ProjectsPanel />
              </div>
            </motion.aside>
          </div>
          <motion.div {...arrive(3)} className="mt-14 border-t pt-10">
            <RehearsalsPanel />
          </motion.div>
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
