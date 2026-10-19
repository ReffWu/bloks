// What shows while an agent is working: its words streaming in, the
// typing dots, and the live browser frame. Split out of ChatView.tsx,
// which only wires them in.
import { useState } from "react";
import { api } from "@/state/store";
import { Markdownish } from "@/components/Markdown";


/** Frames arrive as base64 from the agent's computer. The mime type is
 * pinned to an image allowlist so a frame can never widen into some
 * other kind of data URI. */
export const FRAME_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  const safeMime = mime && FRAME_MIMES.has(mime) ? mime : "image/png";
  return (
    <div className="flex animate-rise-in justify-start">
      <img
        src={`data:${safeMime};base64,${png}`}
        alt="Agent screen"
        className="max-w-[82%] rounded-xl border sm:max-w-[68%]"
      />
    </div>
  );
}

/** The agent's browser while it works: the latest frame, and a way in.
 * A click on the picture clicks the page at the same spot, and the line
 * under it types into whatever has focus. For the logins and cookie
 * walls an agent cannot get past on its own. */
export function LiveBrowser({ botId, frame }: { botId: string; frame: { png: string; mime: string } }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const safeMime = FRAME_MIMES.has(frame.mime) ? frame.mime : "image/png";
  const send = (action: "click" | "type", body: Record<string, unknown>) =>
    api(`/api/bots/${botId}/browser/${action}`, { method: "POST", body: JSON.stringify(body) })
      .then(() => setError(null))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="flex animate-rise-in justify-start">
      <div className="max-w-[82%] overflow-hidden rounded-xl border sm:max-w-[68%]">
        <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-small text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          Live browser. Click or type to help.
        </div>
        <img
          src={`data:${safeMime};base64,${frame.png}`}
          alt="The agent's browser"
          className="block w-full cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            void send("click", { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
          }}
        />
        <form
          className="border-t"
          onSubmit={(e) => {
            e.preventDefault();
            void send("type", { text, enter: true });
            setText("");
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type here, Enter to send"
            aria-label="Type into the agent's browser"
            className="w-full bg-transparent px-2.5 py-1.5 text-body outline-none placeholder:text-muted-foreground"
          />
        </form>
        {error && <div className="border-t px-2.5 py-1 text-small text-destructive">{error}</div>}
      </div>
    </div>
  );
}

export function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="streaming-text w-full min-w-0 py-1.5 text-lead text-foreground">
        <Markdownish text={text} />
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex animate-rise-in justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
    </div>
  );
}
