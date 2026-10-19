// The eight colours of the Bloks mark as a row of swatches. Picking one
// recolours the app at once: the variables it sets are the ones every
// accented thing already reads (lib/accent.ts).
import { useState } from "react";
import { Check } from "@/components/icons";
import { ACCENTS, chooseAccent, onFill, storedAccent } from "@/lib/accent";
import { cn } from "@/lib/cn";

export function AccentPicker() {
  const [chosen, setChosen] = useState(() => storedAccent().id);
  return (
    <div role="radiogroup" aria-label="Accent" className="flex flex-wrap items-center gap-2">
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
