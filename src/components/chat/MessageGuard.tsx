// A message the page cannot draw stands as one quiet line, with its
// details to copy into a bug report, and the rest of the conversation
// stays (src/lib/rowGuard.ts says why). Rooms, a single agent's chat and a
// member's transcript all draw their rows through it.
import { useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RowGuard } from "@/lib/rowGuard";

const report = (details: string) => {
  console.error(`a message could not be drawn: ${details}`);
  void window.bloks?.appLog?.(`a message could not be drawn: ${details}`).catch(() => {});
};

export function MessageGuard({
  id,
  resetKey,
  render,
  className,
}: {
  /** The message's id, so Find and a link can still land on its place. */
  id: string;
  /** The message itself: a new copy of it is tried again. */
  resetKey: unknown;
  render: () => React.ReactNode;
  className?: string;
}) {
  return (
    <RowGuard
      render={render}
      resetKey={resetKey}
      onError={report}
      fallback={(details) => <Undrawn id={id} details={details} className={className} />}
    />
  );
}

function Undrawn({ id, details, className }: { id: string; details: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      .writeText(details)
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <div
      role="note"
      data-message-id={id}
      className={cn(
        "flex max-w-[560px] items-center gap-2 rounded-xl border border-dashed px-3 py-1.5 text-small text-muted-foreground",
        className,
      )}
    >
      <AlertTriangle size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">{t("messageGuard.couldNotShow")}</span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-brand-ink transition-colors duration-150 hover:bg-accent"
      >
        {copied ? t("common.copied") : t("errorBoundary.copyDetails")}
      </button>
    </div>
  );
}
