// One message that cannot be drawn costs that message, not the window.
//
// The interface has one net under all of it (components/ErrorBoundary.tsx),
// and a conversation draws every message in its window. A single message
// the page cannot draw, often an old one that scrolling up brings into the
// window, took the whole window with it and left only Reload: a team chat
// on a Docker server, reported by a person who then had to reload every
// time they scrolled back. So every row is drawn inside this instead. The
// row that throws becomes whatever `fallback` draws, given the details for
// a bug report, and every other message stays where it was.
//
// The row is a function the guard calls, not an element handed to it: a
// row is worked out while it is laid out (who a route went to, whose run of
// tool calls it is), and a throw there happens in the parent's render, out
// of reach of any boundary below it. Called here, it is in reach.
//
// No JSX, so the tests can hold it without a browser (test/row-guard.test.ts).
import { Component, createElement, Fragment, type ErrorInfo, type ReactNode } from "react";
import { errorDetails } from "./errorDetails.ts";

export interface RowGuardProps {
  /** Works the row out and draws it, inside the guard. */
  render: () => ReactNode;
  /** What stands in for a row that threw, given the details. */
  fallback: (details: string) => ReactNode;
  /** The row's data. When it changes, a row that failed is tried again:
   * an edit or a fresh copy from the server may well draw. */
  resetKey?: unknown;
  /** Told once a failure, with where in the interface it was. */
  onError?: (details: string) => void;
}

interface RowGuardState {
  details: string | null;
  key: unknown;
}

function Drawn({ render }: { render: () => ReactNode }) {
  return createElement(Fragment, null, render());
}

export class RowGuard extends Component<RowGuardProps, RowGuardState> {
  state: RowGuardState = { details: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): { details: string } {
    return { details: errorDetails(error, null) };
  }

  static getDerivedStateFromProps(props: RowGuardProps, state: RowGuardState): RowGuardState | null {
    return props.resetKey === state.key ? null : { details: null, key: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const details = errorDetails(error, info.componentStack);
    this.setState({ details });
    this.props.onError?.(details);
  }

  render() {
    return this.state.details === null
      ? createElement(Drawn, { render: this.props.render })
      : this.props.fallback(this.state.details);
  }
}
