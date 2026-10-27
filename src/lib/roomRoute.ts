// Who answers a room message that names nobody, read the way the server
// decides it, and the line above a reply that says what a room's Auto
// chose. Both are the server's own words (server/room-route.ts), so what
// the room shows is what was said in its chat channel too.
export { ROOM_ANSWERS, answersOf, routeWords, type RoomAnswers, type RoomRoute } from "../../server/room-route.ts";
import type { RoomAnswers } from "../../server/room-route.ts";

/** Each choice as the room's menus say it, with what it does in one line.
 * `lead` is the lead's name, or null when the room has none yet. */
export function answersWords(answers: RoomAnswers, lead: string | null): { label: string; hint: string } {
  const leader = lead ?? "The lead";
  if (answers === "lead") return { label: "Only the lead", hint: `${leader} answers unless you @name someone.` };
  if (answers === "auto") return { label: "Auto", hint: `A small model picks who fits each message. ${leader} answers if it can't.` };
  return { label: "Everyone", hint: "Anyone can answer. @name to ask one." };
}
