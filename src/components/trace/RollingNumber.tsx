// A number whose digits roll to their new value, each on its own wheel,
// like an odometer, rather than the whole number being swapped.
//
// Digits are kept in place from the right, so "9.9s" becoming "10s"
// rolls the units and grows a digit on the left instead of shuffling
// every wheel along by one. Anything that is not a digit (a dot, a "k",
// a "$") is set as it is. Reduce motion sets the value outright
// (styles.css).
import { cn } from "@/lib/cn";

const WHEEL = Array.from({ length: 10 }, (_, d) => d);

function Digit({ digit }: { digit: number }) {
  return (
    <span aria-hidden className="rolling-digit relative inline-block h-[1lh] overflow-hidden">
      <span className="flex flex-col" style={{ transform: `translateY(${-digit}lh)` }}>
        {WHEEL.map((d) => (
          <span key={d} className="h-[1lh] text-center">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = [...value];
  return (
    <span className={cn("inline-flex whitespace-pre tabular-nums", className)}>
      <span className="sr-only">{value}</span>
      {chars.map((char, i) => {
        // counted from the right, so a wheel keeps its place as the
        // number gains or loses a digit on the left
        const place = chars.length - i;
        return /\d/.test(char) ? (
          <Digit key={`d${place}`} digit={Number(char)} />
        ) : (
          <span key={`c${place}${char}`} aria-hidden>
            {char}
          </span>
        );
      })}
    </span>
  );
}
