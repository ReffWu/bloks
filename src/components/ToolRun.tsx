// The tool calls between two things worth reading, as a quiet timeline.
//
// A single call shows as itself. Two or more fold into a count ("Ran 4
// commands, read 6 files") that opens to the list, each call a mark on
// one thin rail. While one is still running the line names it and how
// long it has been going, so a long turn still shows what it is doing
// right now.
//
// The marks are small on purpose: a ring for the call going now, a check
// once it is done, a red cross when it failed, a dash when it was
// stopped. None of them moves. The working line at the end of the
// transcript (chat/Live.tsx) is the one thing that says the agent is at
// work; a spinner here as well drew two of them at once.
//
// A failed call opens to what it ran, so the error is one click away.
// The output itself went to the agent and is not kept here.
//
// A turn that has made one call over and over carries a chip saying so
// (server/repeats.ts), on the run holding the row the server marked.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { Minus } from "@/components/icons";
import { Repeat } from "@/components/icons";
import { X } from "@/components/icons";
import type { Message } from "@/state/store";
import { repeatedIn, runningCall, summarize, toolLabel } from "@/lib/tool-summary";
import { Elapsed } from "./chat/Live";
import { cn } from "@/lib/cn";

type Tool = NonNullable<Message["tool"]>;
type CallState = "running" | "done" | "failed" | "stopped";

function stateOf(tool: Tool): CallState {
  if (tool.stopped) return "stopped";
  if (tool.ok === undefined) return "running";
  return tool.ok === false ? "failed" : "done";
}

/** A call's mark. When the call settles, the ring gives way to its check
 * (or cross) in place; a row drawn already settled just shows it. */
function Mark({ state, className }: { state: CallState; className?: string }) {
  return (
    <span role="img" aria-label={state} className={cn("relative flex size-3 shrink-0 rounded-full", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={state}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
        >
          {state === "running" ? (
            // open, not filled: a step not yet done, and not to be read as
            // the working line's dot, which is the one that moves
            <span className="size-[7px] rounded-full border border-foreground/60" />
          ) : state === "done" ? (
            <Check size={11} className="text-muted-foreground/80" />
          ) : state === "failed" ? (
            <X size={11} className="text-destructive" />
          ) : (
            <Minus size={11} className="text-muted-foreground/70" />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Call({ message, onRail }: { message: Message; onRail?: boolean }) {
  const tool = message.tool!;
  const state = stateOf(tool);
  const [open, setOpen] = useState(false);
  const label = toolLabel(tool);
  const failed = state === "failed";
  // What opening shows: the whole command, or a name too long for the
  // row (a failure's name is often its error). A failure always opens,
  // to say what became of it.
  const full = tool.command ?? (tool.name.length > 56 ? tool.name : null);
  const opens = Boolean(full) || failed;
  return (
    <div
      className={cn("min-w-0 max-w-full text-small", failed ? "text-destructive" : "text-muted-foreground")}
      title={state === "stopped" ? "Stopped before it finished" : undefined}
    >
      <div className={cn("flex min-w-0 items-center gap-2 py-0.5", onRail && "-ml-[6.5px]")}>
        {/* on the rail the mark sits over the line, on the page's colour */}
        <Mark state={state} className={onRail ? "bg-background" : undefined} />
        {opens ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={cn(
              "min-w-0 max-w-[480px] truncate rounded-sm text-left font-mono transition-colors duration-150",
              failed ? "hover:text-destructive/80" : "hover:text-foreground",
            )}
          >
            {label}
          </button>
        ) : (
          <span className="min-w-0 max-w-[480px] truncate font-mono">{label}</span>
        )}
        {state === "running" && <Elapsed since={message.at} className="text-caption text-muted-foreground/80" />}
      </div>
      {opens && open && (
        <div className={cn("mt-1 mb-1 flex max-w-full animate-fade-in flex-col gap-1", onRail ? "ml-3.5" : "ml-5")}>
          {full && (
            <pre className="max-w-full select-text whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-small text-foreground">
              {full}
            </pre>
          )}
          {failed && (
            <span className="text-caption text-muted-foreground">
              {tool.command ? "Failed. Its output went to the agent, not here." : "This step failed."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "Same call repeated 10 times": small, beside the line, and a warning
 * rather than an error, since nothing has gone wrong that anyone knows. */
function Repeated({ count }: { count: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-caption font-medium text-warning"
      title="Same call, same inputs, again and again. It may be stuck. Nothing was stopped."
    >
      <Repeat size={11} aria-hidden />
      Repeated {count} times
    </span>
  );
}

export function ToolRun({ messages, fresh, className }: { messages: Message[]; fresh?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const tools = messages.filter((m) => m.tool).map((m) => m.tool!);
  if (!tools.length) return null;
  const repeated = repeatedIn(messages);
  if (messages.length === 1) {
    return (
      <div className={cn("flex min-w-0 max-w-full flex-wrap items-center justify-start gap-x-2 gap-y-1 px-1.5", fresh && "animate-receive-in", className)}>
        <Call message={messages[0]} />
        {repeated > 0 && <Repeated count={repeated} />}
      </div>
    );
  }
  const current = runningCall(messages);
  const state: CallState = current ? "running" : tools.every((t) => t.stopped) ? "stopped" : "done";
  return (
    <div className={cn("flex min-w-0 max-w-full flex-col items-start px-1.5", fresh && "animate-receive-in", className)}>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 max-w-full items-center gap-2 rounded-md py-0.5 text-small text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <Mark state={state} />
          <span className="truncate">
            {summarize(tools)}
            {current && <span className="font-mono"> · {toolLabel(current.tool!)}</span>}
          </span>
          {current && <Elapsed since={current.at} className="text-caption text-muted-foreground/80" />}
          <ChevronRight size={12} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
        </button>
        {repeated > 0 && <Repeated count={repeated} />}
      </div>
      {open && (
        <div className="ml-[5.5px] mt-0.5 flex min-w-0 max-w-full animate-fade-in flex-col border-l">
          {messages.map((m) => (
            <Call key={m.id} message={m} onRail />
          ))}
        </div>
      )}
    </div>
  );
}
