// The three ways words sent mid-turn can go (server/delivery.ts), in the
// words both Settings pages use for them.
export type DeliveryMode = "auto" | "interrupt" | "queue";

export const DELIVERY_MODES: Array<{ value: DeliveryMode; label: string; says: string }> = [
  {
    value: "auto",
    label: "Automatic",
    says: "Stops, corrections and answers go in right away. Everything else waits until it finishes.",
  },
  { value: "interrupt", label: "Interrupt", says: "Everything you send goes in right away." },
  { value: "queue", label: "Queue", says: "Everything you send waits until it finishes." },
];

export const modeWords = (mode: DeliveryMode) => DELIVERY_MODES.find((m) => m.value === mode) ?? DELIVERY_MODES[0];
