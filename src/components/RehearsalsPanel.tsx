// Rehearsals, side by side.
//
// Each task an agent rehearsed, or several agents rehearsed to compare,
// with what every attempt would change and what it said about it. The
// card under each attempt is the same one its lane shows (ChangesCard):
// Apply writes that attempt into the real folder and discards the rest
// of the task's attempts, Discard lets one go. See server/rehearsals.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { api, useStore, type Message } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { ChangesCard } from "./ChangesCard";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/plural";

interface Attempt {
  id: string;
  group: string;
  botId: string;
  taskId: string;
  dir: string;
  text: string;
  state: "running" | "ready" | "empty" | "applied" | "discarded" | "failed";
  at: number;
  said: string;
  changes: Message["changes"] | null;
}

const STATE: Record<Attempt["state"], string> = {
  running: "Rehearsing",
  ready: "Ready to review",
  empty: "Changed nothing",
  applied: "Applied",
  discarded: "Discarded",
  failed: "Did not finish",
};

export function RehearsalsPanel() {
  const { state, dispatch } = useStore();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/rehearsals")
      .then((r) => setAttempts(r.rehearsals ?? []))
      .catch((e: Error) => setError(e.message));
  }, []);
  // the server says when anything moves; this re-reads then
  useEffect(load, [load, state.rehearsalsTick]);

  // attempts at one task together, newest task first
  const groups = useMemo(() => {
    const out = new Map<string, Attempt[]>();
    for (const a of attempts ?? []) out.set(a.group, [...(out.get(a.group) ?? []), a]);
    return [...out.values()].map((list) => [...list].sort((p, q) => p.at - q.at));
  }, [attempts]);

  const open = (a: Attempt) => {
    dispatch({ type: "select", id: a.botId, lane: a.taskId });
  };

  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card"
      role="region"
      aria-label="Rehearsals"
    >
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-title font-semibold text-foreground">
            <FlaskConical size={17} className="text-muted-foreground" />
            Rehearsals
          </div>
          <div className="mt-0.5 text-body text-muted-foreground">
            Work done on a copy of the folder, waiting for you. Apply one attempt and the others are discarded.
          </div>
        </div>
      </div>

      <div className="p-5">
        {error && <div className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>}
        {attempts === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-body text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Reading rehearsals
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-body leading-relaxed text-muted-foreground">
            Nothing rehearsed yet. In any chat, press the flask beside the microphone, describe the task, and the agent
            does it on a copy of its folder. Pick other agents there too, and they each try it, side by side, here.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => {
              const first = group[0];
              return (
                <section key={first.group}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-ui font-medium text-foreground">{first.text}</div>
                      <div className="mt-0.5 truncate text-small text-muted-foreground">
                        {new Date(first.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {" · "}
                        <span className="font-mono">{first.dir}</span>
                      </div>
                    </div>
                    {group.length > 1 && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {plural(group.length, "attempt")}
                      </span>
                    )}
                  </div>
                  <div className={cn("grid gap-3", group.length > 1 ? "md:grid-cols-2" : "", group.length > 2 ? "lg:grid-cols-3" : "")}>
                    {group.map((a) => {
                      const agent = state.bots.find((b) => b.id === a.botId);
                      return (
                        <div key={a.id} className="flex min-w-0 flex-col gap-2 rounded-2xl border bg-muted/30 p-3">
                          <div className="flex items-center gap-2">
                            {agent && <AgentAvatar bot={agent} size={22} />}
                            <span className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
                              {agent?.name ?? "An agent"}
                            </span>
                            <span
                              className={cn(
                                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption",
                                a.state === "ready" ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {a.state === "running" && <Loader2 size={10} className="animate-spin" />}
                              {STATE[a.state]}
                            </span>
                          </div>
                          {a.changes && (
                            <ChangesCard message={{ id: `rehearsal-${a.id}`, role: "bot", kind: "changes", changes: a.changes, at: a.at } as Message} />
                          )}
                          {a.said && (
                            <p className="line-clamp-4 whitespace-pre-line px-1 text-body leading-relaxed text-muted-foreground">
                              {a.said}
                            </p>
                          )}
                          <button
                            onClick={() => open(a)}
                            className="mt-auto flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-small text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <MessageSquare size={13} />
                            Open the conversation
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>

  );
}
