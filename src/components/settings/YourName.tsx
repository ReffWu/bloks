// "Your name": what your agents call you, and what everybody you let in
// sees you as, on their screens, in invites and in link previews.
//
// One row, kept on its own so Settings can place it wherever it reads
// best. It saves the way the workspace's own name does: on Enter or on
// leaving the field, Escape puts it back. The server keeps it and tells
// everyone who shows it (server/index.ts setOwnerName), so there is
// nothing else to refresh here. Once people see it, it can change but not
// go, and the server says so if that is tried.
//
// With no name yet the field is empty, never a placeholder that looks
// like a name already kept. Stepping into it offers the account's own
// name, selected: Enter keeps it, typing replaces it, and leaving it
// untouched keeps nothing.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useStore } from "@/state/store";
import { readYourName, saveYourName } from "@/lib/yourName";
import { SettingRow } from "../SettingsLayout";

export function YourName() {
  const { state } = useStore();
  const saved = state.config?.profile?.name ?? "";
  const [draft, setDraft] = useState(saved);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The account's name, put in the field and not yet chosen. */
  const offered = useRef(false);
  /** Enter was pressed: what is in the field is meant. */
  const meant = useRef(false);

  // follows a change made anywhere else: another window, the phone, the
  // question asked before an invite
  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => {
    let alive = true;
    void readYourName().then((said) => alive && setSuggested(said.suggested));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const chosen = meant.current || !offered.current;
    offered.current = false;
    meant.current = false;
    if (!chosen) return setDraft(saved);
    const clean = draft.replace(/\s+/g, " ").trim();
    if (clean === saved) return setDraft(saved);
    try {
      setDraft(await saveYourName(clean));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDraft(saved);
    }
  };

  return (
    <SettingRow
      label="Your name"
      htmlFor="your-name"
      description="What your agents call you, and what everyone you let in sees."
      control={
        <Input
          id="your-name"
          value={draft}
          maxLength={40}
          autoComplete="name"
          placeholder="Not set"
          onFocus={(e) => {
            if (saved || draft || !suggested) return;
            offered.current = true;
            setDraft(suggested);
            const field = e.currentTarget;
            requestAnimationFrame(() => field.select());
          }}
          onChange={(e) => {
            offered.current = false;
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              meant.current = true;
              (e.currentTarget as HTMLInputElement).blur();
            }
            if (e.key === "Escape" && draft !== saved) {
              e.stopPropagation();
              setDraft(saved);
            }
          }}
          className="w-[240px] max-sm:w-[180px]"
        />
      }
    >
      {error && (
        <div role="alert" className="mt-2 text-small text-destructive">
          {error}
        </div>
      )}
    </SettingRow>
  );
}
