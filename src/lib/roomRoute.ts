// Who answers a room message that names nobody, read the way the server
// decides it, and the line above a reply that says what a room's Auto
// chose. Both are the server's own words (server/room-route.ts), so what
// the room shows is what was said in its chat channel too.
export { ROOM_ANSWERS, answersOf, routeWords, type RoomAnswers, type RoomRoute } from "../../server/room-route.ts";
import type { RoomAnswers } from "../../server/room-route.ts";
import { t } from "./i18n.ts";

/** Each choice as the room's menus say it, with what it does in one line.
 * `lead` is the lead's name, or null when the room has none yet. */
export function answersWords(answers: RoomAnswers, lead: string | null): { label: string; hint: string } {
  const leader = lead ?? t("roomRoute.theLead");
  if (answers === "lead") return { label: t("roomRoute.lead.label"), hint: t("roomRoute.lead.hint", { lead: leader }) };
  if (answers === "auto") return { label: t("roomRoute.auto.label"), hint: t("roomRoute.auto.hint", { lead: leader }) };
  return { label: t("roomRoute.everyone.label"), hint: t("roomRoute.everyone.hint") };
}
