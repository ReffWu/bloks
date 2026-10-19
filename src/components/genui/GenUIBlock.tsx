// One openui fence in a reply, drawn as interface.
//
// The reply's markdown hands each ```openui fence here (Markdown.tsx) and
// draws the prose around it as it always has. While the reply streams,
// the fence is drawn as it grows: OpenUI's parser keeps every finished
// statement and closes the one still arriving, so each chunk is a whole
// interface, a little more of it each time. Clicks wait until the reply
// is done.
//
// Nothing an agent writes may break the bubble it is in. A part that
// will not draw is left out by the renderer itself; a part that throws
// while drawing keeps its last good look; and a fence that settles into
// nothing at all says so in one quiet line, with what was written a
// click away, because an answer silently missing is worse than an
// answer shown plainly.
import { Component, createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Renderer, type ActionEvent, type ParseResult } from "@openuidev/react-lang";
import { CodeView } from "@/components/Markdown";
import { useStore } from "@/state/store";
import { routeAction } from "@/lib/genui/actions";
import { LabelProvider, useGenUiTarget, useLabelBook } from "./host";
import { genuiLibrary } from "./library";

/** Set inside a drawn answer. Markdown in a TextContent that holds a
 * fence of its own draws it as code: an answer does not nest answers. */
export const InsideGenUi = createContext(false);

export function useInsideGenUi(): boolean {
  return useContext(InsideGenUi);
}

/** Holds a failure to the block it happened in. A fence still arriving
 * gets another chance with every chunk; a settled one stays as it fell. */
class Contain extends Component<{ fallback: ReactNode; children: ReactNode; again: string }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  componentDidUpdate(before: { again: string }) {
    if (this.state.broken && before.again !== this.props.again) this.setState({ broken: false });
  }
  render() {
    return this.state.broken ? this.props.fallback : this.props.children;
  }
}

function Undrawn({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed px-3.5 py-2.5 text-small text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>This part of the answer couldn't be drawn.</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
        >
          {open ? "Hide it" : "Show what was written"}
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <CodeView lang="openui" code={code} />
        </div>
      )}
    </div>
  );
}

export function GenUIBlock({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const { dispatch } = useStore();
  const target = useGenUiTarget();
  const labels = useLabelBook();
  const [empty, setEmpty] = useState(false);

  const onAction = useCallback(
    (event: ActionEvent) => {
      const outcome = routeAction(event, target, labels);
      switch (outcome.kind) {
        case "send":
          dispatch({ type: "send", botId: outcome.botId, text: outcome.text });
          break;
        case "room":
          dispatch({ type: "sendToRoom", blokId: outcome.roomId, text: outcome.text });
          break;
        case "open":
          // The desktop shell hands an http(s) window to the browser and
          // refuses anything else (electron/main.mjs).
          window.open(outcome.url, "_blank", "noopener,noreferrer");
          break;
      }
    },
    [target, labels, dispatch],
  );

  const onParseResult = useCallback(
    (result: ParseResult | null) => {
      // Half a reply is not a failed one: only a settled fence that came
      // to nothing says so.
      if (!streaming) setEmpty(!result || (!result.root && !result.rootExpression));
    },
    [streaming],
  );

  const fallback = <Undrawn code={code} />;
  if (empty && !streaming) return <div data-genui className="min-w-0">{fallback}</div>;
  return (
    <div data-genui className="min-w-0">
      <Contain fallback={fallback} again={code}>
        <InsideGenUi.Provider value>
          <LabelProvider value={labels}>
            <Renderer
              response={code}
              library={genuiLibrary}
              isStreaming={streaming}
              onAction={onAction}
              onParseResult={onParseResult}
              // No tools: Query and Mutation have nothing to call, so they
              // keep whatever was written and fetch nothing.
              toolProvider={null}
            />
          </LabelProvider>
        </InsideGenUi.Provider>
      </Contain>
    </div>
  );
}
