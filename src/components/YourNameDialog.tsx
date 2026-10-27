// Asking the owner's name, at the moment somebody else is about to see it.
//
// Setup asks once and lets it be skipped. After that the name is asked
// for only where it is needed: making a Team workspace, sharing a room,
// inviting somebody. Those are the moments a missing name would show up
// on another person's screen as "The owner", so the question comes right
// there, small, already filled in with the name this computer's account
// carries, and one Continue carries on with what the person was doing.
//
// `await askYourName()` answers the name, or null when the person would
// rather not, from anywhere, the way confirm() does (ui/confirm.tsx). One
// YourNameHost draws it (App.tsx). `ensureYourName()` asks only when there
// is no name yet.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readYourName, saveYourName } from "@/lib/yourName";
import { t } from "@/lib/i18n";

export interface AskNameOptions {
  /** Who will see it, in a sentence: "Everyone you invite to Okafor Studio sees it." */
  why?: string;
  /** Save it to this workspace as well as answer it. Off for a window
   * whose server is somebody else's (a joined workspace), which hands
   * the name to the app instead. */
  save?: boolean;
  /** What the field starts with, when the caller knows better than the
   * account's suggestion. */
  prefill?: string;
}

interface Asking extends AskNameOptions {
  id: number;
  answer: (name: string | null) => void;
}

let asking: Asking | null = null;
let asked = 0;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function askYourName(options: AskNameOptions = {}): Promise<string | null> {
  // nobody mounted to ask with: nothing can be asked, so nothing goes on
  if (hosts === 0) return Promise.resolve(null);
  // one question at a time; a second one asked meanwhile waits on the first
  if (asking) {
    const first = asking;
    return new Promise((resolve) => {
      const was = first.answer;
      first.answer = (name) => {
        was(name);
        resolve(name);
      };
    });
  }
  return new Promise((resolve) => {
    const id = ++asked;
    asking = {
      ...options,
      id,
      answer: (name) => {
        if (asking?.id !== id) return;
        asking = null;
        emit();
        resolve(name);
      },
    };
    emit();
  });
}

/** The owner's name: the one saved, or asked for now. Null when the
 * person closed the question, and whatever they were doing waits. */
export async function ensureYourName(options: AskNameOptions = {}): Promise<string | null> {
  const { name } = await readYourName();
  return name || askYourName(options);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => asking;

/** The dialog every askYourName() opens. Mounted once, at the top of the app. */
export function YourNameHost() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (hosts === 0) asking?.answer(null);
    };
  }, []);
  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && current?.answer(null)}>
      {current && <NameQuestion key={current.id} asking={current} />}
    </Dialog>
  );
}

function NameQuestion({ asking: q }: { asking: Asking }) {
  const [name, setName] = useState(q.prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // the account's own name, unless something better was handed in or the
  // person has started typing
  const typed = useRef(Boolean(q.prefill));
  useEffect(() => {
    if (q.prefill) return;
    let alive = true;
    void readYourName().then(({ name: saved, suggested }) => {
      const offer = saved || suggested;
      if (!alive || typed.current || !offer) return;
      setName(offer);
      // selected, so typing replaces a suggestion that is wrong
      requestAnimationFrame(() => field.current?.select());
    });
    return () => {
      alive = false;
    };
  }, [q.prefill]);

  const clean = name.replace(/\s+/g, " ").trim();
  const go = async () => {
    if (!clean || busy) return;
    if (q.save === false) return q.answer(clean);
    setBusy(true);
    setError(null);
    try {
      q.answer(await saveYourName(clean));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <DialogContent
      className="w-[calc(100%-2rem)] max-w-[400px]"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }}
    >
      <DialogTitle className="text-pretty pr-6">{t("yourNameDialog.whatShouldPeopleCallYou")}</DialogTitle>
      <DialogDescription className="text-pretty">
        {t("yourNameDialog.why", { why: q.why ?? t("yourNameDialog.everyoneYouLetInSees") })}
      </DialogDescription>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Input
            ref={field}
            value={name}
            maxLength={40}
            autoComplete="name"
            aria-label={t("common.yourName")}
            placeholder={t("common.yourName")}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              typed.current = true;
              setName(e.target.value);
              setError(null);
            }}
            className="h-10 rounded-[10px]"
          />
          {error && (
            <span role="alert" className="text-small text-destructive">
              {error}
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => q.answer(null)}>
            {t("common.notNow")}
          </Button>
          <Button type="submit" disabled={!clean || busy} className="min-w-[96px]">
            {busy ? <Loader2 size={14} className="animate-spin" /> : t("common.continue")}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
