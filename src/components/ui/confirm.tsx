// A question before something that cannot easily be taken back, asked in
// the app's own voice instead of the browser's grey box.
//
// `await confirm({ title, body, confirmLabel, destructive })` answers true
// or false, from anywhere: a click handler does not need a context or a
// piece of state to ask. One ConfirmHost draws it (App.tsx); questions
// asked while one is open wait their turn rather than replacing it.
//
// Where the focus starts is the point of the thing. A destructive question
// opens on Cancel, so a reflexive Enter keeps what you had; any other
// opens on the confirm button, so Enter goes ahead. Esc, a click outside
// and Cancel all answer no.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface ConfirmOptions {
  /** The question, short: "Delete this backup?" */
  title: string;
  /** What happens, and what is kept. A blank line starts a new paragraph. */
  body?: string;
  /** Says what the button does: "Delete", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red, and the focus starts on Cancel. */
  destructive?: boolean;
}

interface Asking extends ConfirmOptions {
  id: number;
  answer: (yes: boolean) => void;
}

let queue: Asking[] = [];
let asked = 0;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirm(options: ConfirmOptions): Promise<boolean> {
  // Nothing mounted to ask with (the quick-ask panel shares this bundle
  // but not the shell), so the browser asks instead of nobody.
  if (hosts === 0) {
    const words = options.body ? `${options.title}\n\n${options.body}` : options.title;
    return Promise.resolve(window.confirm(words));
  }
  return new Promise((resolve) => {
    const id = ++asked;
    queue = [
      ...queue,
      {
        ...options,
        id,
        answer: (yes) => {
          // answered once: a click and the close it causes are one answer
          if (!queue.some((q) => q.id === id)) return;
          queue = queue.filter((q) => q.id !== id);
          emit();
          resolve(yes);
        },
      },
    ];
    emit();
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => queue;

/** The dialog every confirm() opens. Mounted once, at the top of the app. */
export function ConfirmHost() {
  const asking = useSyncExternalStore(subscribe, snapshot, snapshot)[0] ?? null;
  const safe = useRef<HTMLButtonElement>(null);
  const go = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      // a host going away leaves nobody to answer, so the answer is no
      if (hosts === 0) for (const q of queue) q.answer(false);
    };
  }, []);

  const paragraphs = asking?.body?.split(/\n\s*\n/).filter(Boolean) ?? [];

  return (
    <Dialog open={asking !== null} onOpenChange={(open) => !open && asking?.answer(false)}>
      {asking && (
        <DialogContent
          // a fresh dialog per question, so its focus starts over
          key={asking.id}
          showCloseButton={false}
          // a question with no way past it but an answer: an alert dialog
          role="alertdialog"
          className="w-[calc(100%-2rem)] max-w-[400px]"
          // no body, no description: said outright, or Radix warns
          {...(paragraphs.length ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (asking.destructive ? safe : go).current?.focus();
          }}
        >
          <DialogTitle className="text-pretty pr-2">{asking.title}</DialogTitle>
          {paragraphs.length > 0 && (
            <DialogDescription asChild>
              <div className="flex flex-col gap-2">
                {paragraphs.map((p, i) => (
                  <p key={i} className="text-pretty">
                    {p}
                  </p>
                ))}
              </div>
            </DialogDescription>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button ref={safe} variant="secondary" onClick={() => asking.answer(false)}>
              {asking.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              ref={go}
              variant={asking.destructive ? "destructive" : "default"}
              className={asking.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={() => asking.answer(true)}
            >
              {asking.confirmLabel ?? "Continue"}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
