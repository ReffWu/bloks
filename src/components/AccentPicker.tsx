// The eight colours of the Bloks mark as a row of swatches. Picking one
// recolours the app at once: the variables it sets are the ones every
// accented thing already reads (lib/accent.ts).
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { ACCENT_EVENT, ACCENTS, chooseAccent, onFill, storedAccent } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function AccentPicker() {
  const [chosen, setChosen] = useState(() => storedAccent().id);
  // the shared accent turned on or off changes what is drawn from outside
  useEffect(() => {
    const follow = () => setChosen(storedAccent().id);
    window.addEventListener(ACCENT_EVENT, follow);
    return () => window.removeEventListener(ACCENT_EVENT, follow);
  }, []);
  return (
    <div role="radiogroup" aria-label={t("accentPicker.accent")} className="flex flex-wrap items-center gap-2">
      {ACCENTS.map((accent) => {
        const on = accent.id === chosen;
        return (
          <button
            key={accent.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={accent.name}
            title={accent.name}
            onClick={() => setChosen(chooseAccent(accent.id).id)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-transform duration-150 ease-out active:scale-90",
              on && "ring-2",
            )}
            style={{ backgroundColor: accent.hex, ...(on ? { ["--tw-ring-color" as string]: accent.hex } : {}) }}
          >
            {on && <Check size={14} strokeWidth={2.5} style={{ color: onFill(accent.hex) }} />}
          </button>
        );
      })}
    </div>
  );
}
