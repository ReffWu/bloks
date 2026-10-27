// Pictures on their way into the next message (GitHub 399).
//
// A pasted picture used to show nothing until it had been made to fit and
// sent to the server, which on a slow way there was long enough to wonder
// whether the paste had landed at all. Now it is a chip the moment it
// arrives, the picture itself from this machine, and it says what it is
// waiting on: being made ready, then going up. Each settles on its own, so
// a slow one never keeps a quick one out of sight.
//
// The chips stay in the order they came. One that is ready waits here,
// drawn as an ordinary chip, until every one before it is ready too, and
// then they join the message together: what rides with the message is
// always in the order it was added, whichever finished first.
//
// One taken away while it travels is gone for good: when its upload
// comes back there is nothing left for it to land in. One that failed
// stays, saying so, with Retry and Remove, and while any is still on its
// way or failed the message waits for it rather than going without.
//
// Only the bookkeeping is here, so it can be tested without a page. The
// composer owns the network and the picture's object URL.
import type { Attachment } from "./attachments.js";
import { t } from "./i18n.ts";

export type PendingStage = "preparing" | "uploading" | "failed" | "ready";

export interface PendingImage<F = unknown> {
  id: string;
  /** What was pasted, picked or dropped, kept for a retry. */
  file: F;
  name: string;
  bytes: number;
  /** The picture from this machine, until the server has it. */
  preview: string;
  stage: PendingStage;
  /** Which try this is. A try that was overtaken (removed, retried)
   * settles nothing when it comes back. */
  attempt: number;
  /** Why it failed, in words. */
  error?: string;
  /** What it became, once ready. Null for one that became nothing. */
  attachment?: Attachment | null;
}

/** New pictures, preparing, after whatever is already waiting. */
export function addPending<F>(
  list: readonly PendingImage<F>[],
  added: ReadonlyArray<Pick<PendingImage<F>, "id" | "file" | "name" | "bytes" | "preview">>,
): PendingImage<F>[] {
  return [...list, ...added.map((item) => ({ ...item, stage: "preparing" as const, attempt: 1 }))];
}

const current = <F>(list: readonly PendingImage<F>[], id: string, attempt: number) =>
  list.find((item) => item.id === id && item.attempt === attempt && (item.stage === "preparing" || item.stage === "uploading"));

/** Made ready and going up now. */
export function uploadingPending<F>(list: readonly PendingImage<F>[], id: string, attempt: number): PendingImage<F>[] {
  if (!current(list, id, attempt)) return [...list];
  return list.map((item) => (item.id === id ? { ...item, stage: "uploading" as const } : item));
}

/** A try came back. Nothing happens for one removed meanwhile, or
 * overtaken by a newer try. */
export function settlePending<F>(
  list: readonly PendingImage<F>[],
  id: string,
  attempt: number,
  outcome: { attachment: Attachment | null } | { error: string },
): PendingImage<F>[] {
  if (!current(list, id, attempt)) return [...list];
  return list.map((item) => {
    if (item.id !== id) return item;
    if ("error" in outcome) return { ...item, stage: "failed" as const, error: outcome.error };
    return { ...item, stage: "ready" as const, attachment: outcome.attachment, error: undefined };
  });
}

/** A failed one, trying again as a new try. */
export function retryPending<F>(list: readonly PendingImage<F>[], id: string): PendingImage<F>[] {
  return list.map((item) =>
    item.id === id && item.stage === "failed" ? { ...item, stage: "preparing" as const, attempt: item.attempt + 1, error: undefined } : item,
  );
}

/** Taken away, whatever it was doing. `gone` is it, for its preview to
 * be let go. */
export function removePending<F>(list: readonly PendingImage<F>[], id: string): { list: PendingImage<F>[]; gone: PendingImage<F> | null } {
  return { list: list.filter((item) => item.id !== id), gone: list.find((item) => item.id === id) ?? null };
}

/** The ready ones at the front, out of the list and into the message, in
 * order. One still on its way keeps those after it here, so the message
 * never has them out of order. `done` are the ones that left. */
export function takeReady<F>(list: readonly PendingImage<F>[]): {
  list: PendingImage<F>[];
  ready: Attachment[];
  done: PendingImage<F>[];
} {
  let front = 0;
  while (front < list.length && list[front]!.stage === "ready") front++;
  const done = list.slice(0, front);
  return {
    list: list.slice(front),
    ready: done.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    done,
  };
}

/** Ready, but held behind one still on its way: these go with the draft
 * when the box does, since nothing is left to wait for them. */
export function heldReady<F>(list: readonly PendingImage<F>[]): Attachment[] {
  return list.flatMap((item) => (item.stage === "ready" && item.attachment ? [item.attachment] : []));
}

/** Why the message cannot go yet: a picture still on its way, or one that
 * failed and has to be retried or removed first. Null when nothing holds
 * it. A failed one says so first, since waiting will not fix it. */
export function sendHeldBy(list: readonly PendingImage[]): "failed" | "pending" | null {
  if (list.some((item) => item.stage === "failed")) return "failed";
  if (list.some((item) => item.stage === "preparing" || item.stage === "uploading")) return "pending";
  return null;
}

/** What the tray says when Send is pressed and a picture holds it. */
export function heldLine(list: readonly PendingImage[]): string | null {
  const held = sendHeldBy(list);
  if (held === "failed") {
    const failed = list.filter((item) => item.stage === "failed").length;
    return t("pendingImages.failed", { count: failed });
  }
  if (held === "pending") {
    const going = list.filter((item) => item.stage === "preparing" || item.stage === "uploading").length;
    return t("pendingImages.waiting", { count: going });
  }
  return null;
}
