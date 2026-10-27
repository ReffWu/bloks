// The trace panel with a made-up turn in it (?trace=demo), for looking
// at the waterfall without an engine running. It polls nothing: a turn
// from the fixture (src/lib/traceView.ts) is read once a second, the way
// the panel reads the server, and the waterfall runs on between reads.
import { useEffect, useMemo, useState } from "react";
import { fixtureScript, fixtureTrace } from "@/lib/traceView";
import { useTheme } from "@/lib/theme";
import { TraceWaterfall } from "./TraceWaterfall";

export function TraceDemo() {
  const { resolvedTheme, setTheme } = useTheme();
  const [epoch, setEpoch] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const script = useMemo(() => fixtureScript(11, { length: 70_000 }), []);
  const trace = fixtureTrace(script, epoch, now - epoch, "Opus 4.7");
  const groups = [{ id: "demo", botId: "demo-scout", name: "Scout", subtitle: "Opus 4.7", color: "blue", trace }];
  return (
    <div className="flex h-full items-stretch justify-center bg-sidebar p-6">
      {/* as wide as the panel beside a conversation (TracePanel.tsx) */}
      <aside className="flex w-[520px] max-w-full flex-col overflow-hidden rounded-xl border bg-background">
        <div className="flex h-11 shrink-0 items-center justify-between border-b pl-4 pr-2">
          <span className="text-ui font-semibold text-foreground">Timeline</span>
          <span className="flex gap-1 text-small text-muted-foreground">
            <button className="rounded-md px-2 py-1 hover:bg-accent" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              className="rounded-md px-2 py-1 hover:bg-accent"
              onClick={() => {
                setEpoch(Date.now());
                setNow(Date.now());
              }}
            >
              Replay
            </button>
          </span>
        </div>
        <TraceWaterfall groups={groups} now={now} className="min-h-0 flex-1" />
      </aside>
    </div>
  );
}
