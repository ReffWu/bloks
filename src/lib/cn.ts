import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale's names (styles.css). Without them tailwind-merge reads
// `text-body` as a colour and drops the colour beside it, so a button's
// label can vanish into its own background.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "caption", "small", "body", "ui", "lead", "title", "heading", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
