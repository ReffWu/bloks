// The three ways words sent mid-turn can go (server/delivery.ts), in the
// words both Settings pages use for them. The words are read when they
// are drawn, so a change of language reaches a list made once.
import { t } from "./i18n.ts";

export type DeliveryMode = "auto" | "interrupt" | "queue";

function mode(value: DeliveryMode): { value: DeliveryMode; readonly label: string; readonly says: string } {
  return {
    value,
    get label() {
      return t(`deliveryModes.${value}.label`);
    },
    get says() {
      return t(`deliveryModes.${value}.says`);
    },
  };
}

export const DELIVERY_MODES: Array<{ value: DeliveryMode; readonly label: string; readonly says: string }> = [
  mode("auto"),
  mode("interrupt"),
  mode("queue"),
];

export const modeWords = (mode: DeliveryMode) => DELIVERY_MODES.find((m) => m.value === mode) ?? DELIVERY_MODES[0];
