// What rides with the next message, as chips in the box, for an agent's
// composer and a room's alike.
//
// A picture is a chip the moment it is pasted, picked or dropped, drawn
// from this machine while it is made ready and goes up, and an ordinary
// chip once the server has it (GitHub 399). The bookkeeping is
// src/lib/pendingImages.ts; this is the part with a page: the object URL
// each picture is shown by, the upload, and the chip.
import { useEffect, useRef, useState } from "react";
import { File as FileIcon } from "@/components/icons";
import { FileImage } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { X } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  attachmentBasename,
  destination,
  formatBytes,
  intakeImage,
  uploadImageAttachment,
  type Attachment,
} from "@/lib/attachments";
import {
  addPending,
  heldReady,
  removePending,
  retryPending,
  settlePending,
  takeReady,
  uploadingPending,
  type PendingImage,
} from "@/lib/pendingImages";
import { t } from "@/lib/i18n";

const STAGE: Record<PendingImage["stage"], string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  failed: "Didn't upload",
  ready: "",
};

const chipButton = "shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** One chip: a ready attachment, or a picture still on its way. The same
 * chip either way, so one that becomes ready settles in place rather than
 * popping in again. */
export function AttachmentChip({
  attachment: a,
  pending,
  onRemove,
  onRetry,
}: {
  attachment?: Attachment;
  pending?: PendingImage<File>;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  // a HEIC photo has no picture this page can draw until the server has
  // made a JPEG of it, so it shows as a picture icon meanwhile
  const [unseen, setUnseen] = useState(false);
  const shown = a ?? pending?.attachment ?? null;
  const stage = shown ? null : (pending?.stage ?? null);
  const name = shown ? (shown.kind === "paste" ? "pasted text" : shown.name) : (pending?.name ?? "image");
  const src = shown?.kind === "image" ? `/api/attachments/${attachmentBasename(shown.path)}` : !shown && pending ? pending.preview : "";
  const going = stage === "preparing" || stage === "uploading";
  return (
    <span
      className={cn(
        "flex max-w-[240px] animate-pop-in items-center gap-1.5 rounded-xl border bg-muted/50 py-1 pl-1.5 pr-1 text-small text-foreground",
        stage === "failed" && "border-warning/40",
      )}
      title={stage === "failed" ? pending?.error : undefined}
      aria-busy={going || undefined}
    >
      {src ? (
        <span className="relative size-7 shrink-0">
          {unseen ? (
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileImage size={14} />
            </span>
          ) : (
            <img
              src={src}
              alt={name}
              onError={() => setUnseen(true)}
              onLoad={() => setUnseen(false)}
              className={cn("size-7 rounded-lg object-cover transition-opacity duration-200", stage && "opacity-50")}
            />
          )}
          {going && (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center text-foreground">
              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
            </span>
          )}
        </span>
      ) : (
        <FileIcon size={14} className="shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{shown?.kind === "paste" ? `Pasted text, ${shown.lines} lines` : name}</span>
      <span className={cn("shrink-0", stage === "failed" ? "text-warning" : "text-muted-foreground")} aria-live="polite">
        {stage ? STAGE[stage] : shown ? formatBytes(shown.bytes) : ""}
      </span>
      {stage === "failed" && onRetry && (
        <button type="button" onClick={onRetry} className={chipButton} aria-label={`Retry ${name}`} title={t("composerAttachments.retry")}>
          <RefreshCw size={12} />
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className={chipButton} aria-label={`Remove ${name}`}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/** The chips in the box, ready ones first and then those on their way, in
 * one list keyed alike, so a picture moving from one to the other keeps
 * its chip. */
export function AttachmentChips({
  attachments,
  images,
  onRemove,
}: {
  attachments: Attachment[];
  images: PendingImages;
  onRemove: (id: string) => void;
}) {
  return [
    ...attachments.map((a) => <AttachmentChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />),
    ...images.items.map((p) => (
      <AttachmentChip key={p.id} pending={p} onRemove={() => images.remove(p.id)} onRetry={() => images.retry(p.id)} />
    )),
  ];
}

/** A picture uploaded for its chip, the way intakeFiles uploads one,
 * saying when it starts going up. */
export function uploadPendingImage(file: File, onUploading: () => void): Promise<Attachment | null> {
  return intakeImage(file, {
    pathOf: (f) => window.bloks?.filePath?.(f) ?? "",
    uploadImage: (f) => uploadImageAttachment(f, undefined, undefined, onUploading),
    sameComputer: async () => (await destination()).sameComputer,
  });
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `p${Math.random().toString(36).slice(2)}`;

const preview = (file: File) => {
  try {
    return URL.createObjectURL(file);
  } catch {
    return "";
  }
};

const letGo = (item: PendingImage<File>) => {
  if (item.preview) URL.revokeObjectURL(item.preview);
};

export type PendingImages = ReturnType<typeof usePendingImages>;

/**
 * Pictures on their way into this box. `onReady` takes those that are
 * ready, in the order they were added, to join the draft; `onFailed` the
 * words for one that did not make it, for the tray.
 */
export function usePendingImages({
  upload = uploadPendingImage,
  onReady,
  onFailed,
}: {
  upload?: (file: File, onUploading: () => void) => Promise<Attachment | null>;
  onReady: (ready: Attachment[]) => void;
  onFailed?: (name: string, error: string) => void;
}) {
  const [items, setItems] = useState<PendingImage<File>[]>([]);
  // what the list is now, for a send in the same batch as a change, and
  // for an upload coming back after renders it did not see
  const list = useRef(items);
  const alive = useRef(true);
  const told = useRef({ onReady, onFailed });
  told.current = { onReady, onFailed };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const item of list.current) letGo(item);
    };
  }, []);

  const commit = (next: PendingImage<File>[]) => {
    if (!alive.current) return;
    const { list: left, ready, done } = takeReady(next);
    for (const item of done) letGo(item);
    list.current = left;
    setItems(left);
    if (ready.length) told.current.onReady(ready);
  };

  const run = (item: PendingImage<File>) => {
    const { id, attempt, file } = item;
    upload(file, () => commit(uploadingPending(list.current, id, attempt)))
      // the chip's own id, so the chip it becomes is the same one
      .then((attachment) => commit(settlePending(list.current, id, attempt, { attachment: attachment && { ...attachment, id } })))
      .catch((error: unknown) => {
        const words = error instanceof Error && error.message ? error.message : "upload failed";
        const before = list.current;
        commit(settlePending(before, id, attempt, { error: words }));
        // only for one still here: a removed one failing is nobody's news
        if (alive.current && before.some((p) => p.id === id && p.attempt === attempt)) told.current.onFailed?.(item.name, words);
      });
  };

  const add = (files: File[]) => {
    if (!files.length) return;
    const added = files.map((file) => ({ id: newId(), file, name: file.name || "pasted image", bytes: file.size, preview: preview(file) }));
    const next = addPending(list.current, added);
    commit(next);
    for (const item of next.slice(-added.length)) run(item);
  };

  const remove = (id: string) => {
    const { list: left, gone } = removePending(list.current, id);
    if (gone) letGo(gone);
    commit(left);
  };

  const retry = (id: string) => {
    const next = retryPending(list.current, id);
    commit(next);
    const again = next.find((item) => item.id === id && item.stage === "preparing");
    if (again) run(again);
  };

  return {
    items,
    add,
    remove,
    retry,
    /** The list as it is now, ahead of the render that shows it. */
    now: () => list.current,
    /** Ready but held behind one still on its way, to keep with the draft. */
    held: () => heldReady(list.current),
  };
}
