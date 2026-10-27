// What Redo says before it is pressed (GitHub 258).
//
// Editing a message the agent has already read offers Redo: the agent
// stops if it is working, the conversation and the folder go back to
// before the message, and the new words are sent. There is no dialog.
// The button and the line under the box are the confirmation, so the
// line has to say what goes, in numbers the server counted (GET
// /api/threads/:thread/messages/:id/redo), and what cannot come back.
//
// Only the wording is here. Whether Redo is offered, and what it would
// take back, is the server's to say: it holds the turns and the files.
import { t } from "./i18n.ts";

/** What the server says about redoing one message: what it would take
 * back, or that it is not offered, and why. */
export type RedoPreview =
  | { offered: false; why?: string }
  | {
      offered: true;
      /** Messages taken back, the edited one included. */
      messages: number;
      /** Files put back as the folder stands now. */
      files: number;
      /** The turns taken back sent something that stays sent. */
      sent: boolean;
      /** The agent is working. What the turn it is in has changed is
       * measured when it ends, so `files` cannot count it yet. */
      working: boolean;
      /** How many of the person's messages go again: more than one when
       * other words of theirs were part of the same turn. */
      resend: number;
      /** Where its files are, when it works somewhere else and they are
       * not on this computer: "on build-box over SSH". Nothing there is
       * restored. */
      filesElsewhere?: string;
    };

export type RedoOffer = Extract<RedoPreview, { offered: true }>;

/**
 * The line under the editor: "Takes back 3 messages and puts back 2
 * files." While the agent works it says the stop and leaves the number
 * of files out, since nobody knows it yet. A message that was part of a
 * turn with others of the person's says they go again, and a turn that
 * sent something says what stays.
 */
export function redoLine(offer: RedoOffer, agent: string): string {
  // two counts in one sentence, so each is its own counted phrase
  const messages = t("redo.messages", { count: offer.messages });
  const takes = offer.working
    ? offer.filesElsewhere
      ? t("redo.stopsRemoves", { agent, messages })
      : t("redo.stopsRemovesUndoes", { agent, messages })
    : offer.files > 0
      ? t("redo.removesRestores", { messages, files: t("redo.files", { count: offer.files }) })
      : t("redo.removes", { messages });
  return [
    takes,
    // where they are is the server's phrase ("on build-box over SSH")
    offer.filesElsewhere ? t("redo.filesElsewhere", { where: offer.filesElsewhere }) : "",
    offer.resend > 1 ? t("redo.resends", { count: offer.resend }) : "",
    offer.sent ? t("redo.sentStays") : "",
  ]
    .filter(Boolean)
    .join(" ");
}
