// The last net under the whole interface.
//
// Without it, one part of the app throwing while it draws takes every
// part with it, and the window is left empty with nothing to say why:
// it reads as Bloks having crashed, though the server and every agent are
// still working and nothing they hold is lost. So a calm panel takes the
// interface's place instead, with Reload, and the details to copy into a
// bug report. The error also goes to the app's own log when the desktop
// app is there to keep one.
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { errorDetails } from "@/lib/errorDetails";

export class ErrorBoundary extends Component<{ children: ReactNode }, { details: string | null }> {
  state = { details: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { details: errorDetails(error, null, { userAgent: navigator.userAgent }) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const details = errorDetails(error, info.componentStack, { userAgent: navigator.userAgent });
    this.setState({ details });
    void window.bloks?.appLog?.(`the interface stopped drawing: ${details}`).catch(() => {});
  }

  render() {
    return this.state.details === null ? this.props.children : <Stopped details={this.state.details} />;
  }
}

function Stopped({ details }: { details: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      .writeText(details)
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-ui font-semibold">Something went wrong</h1>
        <p className="text-body text-muted-foreground">
          This window could not draw part of Bloks. Your agents keep working, and nothing they have done is lost.
          Reloading usually brings it back.
        </p>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          <Button variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
      </div>
    </div>
  );
}
