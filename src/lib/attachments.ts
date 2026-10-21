// What rides along with the next message.
//
// Three things can ride: a paste too long to read as typing, a file from
// this machine, and an image. Each becomes a chip above the input rather
// than a wall of text inside it, and on send the chips fold back into
// one plain prompt, so every engine receives the same shape whether the
// user attached anything or not.
//
// Files travel as paths, not bytes: every engine here is an agent that
// can open a path itself, and copying a two-gigabyte video into a prompt
// helps nobody. Images are the exception, because a path into a browser
// drag does not exist; those upload once and the prompt carries the
// saved path.
//
// A path only works where the server can open it. When the conversation
// lives on a server elsewhere (this app connected to another computer, or
// a paired device), a path on this Mac names nothing there, so every file
// is sent to that server instead, in parts small enough to cross Bloks
// Cloud, and the prompt carries the path it landed at (GitHub 332). One
// too big to send is refused here, in words, never passed on as a path.

export type PasteAttachment = {
  kind: "paste";
  id: string;
  text: string;
  bytes: number;
  lines: number;
};

export type FileAttachment = {
  kind: "file";
  id: string;
  path: string;
  name: string;
  bytes: number;
};

export type ImageAttachment = {
  kind: "image";
  id: string;
  path: string;
  name: string;
  bytes: number;
  mime: string;
};

export type Attachment = PasteAttachment | FileAttachment | ImageAttachment;

/** Past either of these, a paste stops being typing and becomes a chip.
 * The line rule catches the narrow-but-endless kind: stack traces, logs. */
export const PASTE_CHARS = 900;
export const PASTE_LINES = 12;

export function isLongPaste(text: string): boolean {
  return text.length >= PASTE_CHARS || text.split("\n").length >= PASTE_LINES;
}

/** Matches the server's cap, checked here so an oversized image is
 * refused before the upload starts rather than partway through it. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** The server's cap on a file that has to be sent rather than named:
 * the same as a file sent from Telegram (server/attachments.ts). */
export const FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Where the conversation's server is, as it says itself
 * (GET /api/attachments/where), and how a file is sent to it. */
export interface Destination {
  /** A path on this computer is one the server can open. */
  sameComputer: boolean;
  /** Each part of a file sent in parts, but the last. */
  partBytes: number;
  fileMaxBytes: number;
  imageMaxBytes: number;
}

/** What to go by when the server cannot say: that a path from here means
 * nothing there, so a file is sent rather than named. Sending one to a
 * server that could have opened it costs a copy; naming one it cannot
 * costs the agent the file. */
const ELSEWHERE: Destination = {
  sameComputer: false,
  partBytes: 384 * 1024,
  fileMaxBytes: FILE_MAX_BYTES,
  imageMaxBytes: IMAGE_MAX_BYTES,
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

let asked: Promise<Destination> | null = null;

/** Where this window's server is. Asked once a page, and again after a
 * failed ask; a fetcher of a test's own is asked every time. */
export function destination(fetcher?: Fetcher): Promise<Destination> {
  const ask = async (): Promise<Destination> => {
    const response = await (fetcher ?? fetch)("/api/attachments/where");
    if (!response.ok) throw new Error(String(response.status));
    const said = (await response.json()) as Partial<Destination>;
    const size = (value: unknown, fallback: number) => (typeof value === "number" && value > 0 ? value : fallback);
    return {
      sameComputer: said.sameComputer === true,
      partBytes: size(said.partBytes, ELSEWHERE.partBytes),
      fileMaxBytes: size(said.fileMaxBytes, ELSEWHERE.fileMaxBytes),
      imageMaxBytes: size(said.imageMaxBytes, ELSEWHERE.imageMaxBytes),
    };
  };
  if (fetcher) return ask().catch(() => ELSEWHERE);
  asked ??= ask().catch(() => {
    asked = null;
    return ELSEWHERE;
  });
  return asked;
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isImage(file: { type: string }): boolean {
  return IMAGE_MIMES.has(file.type.split(";")[0]!.trim().toLowerCase());
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `a${Math.random().toString(36).slice(2)}`;

export function pasteAttachment(text: string): PasteAttachment {
  // Measured once here; the chip re-renders on every keystroke and
  // should not re-encode half a megabyte each time.
  return {
    kind: "paste",
    id: newId(),
    text,
    bytes: new TextEncoder().encode(text).length,
    lines: text.split("\n").length,
  };
}

export function fileAttachment(name: string, path: string, bytes: number): FileAttachment {
  return { kind: "file", id: newId(), path, name, bytes };
}

/** Small pathless text drops (a browser drag of a .txt, a snippet) keep
 * their contents inline instead of being refused for having no path. */
export const INLINE_TEXT_LIMIT = 512 * 1024;

type IncomingFile = Pick<File, "name" | "size" | "type" | "text">;

/**
 * The one intake for the picker, the drop and the paste, so a picked
 * file and a dropped one can never sort differently. The caller owns
 * the network (uploadImage, uploadFile) and the disk-path bridge
 * (pathOf); this owns the ordering and the sentence the user reads when
 * something is refused. Nothing is dropped in silence.
 *
 * `sameComputer` says whether the server can open a path from here; left
 * out, it can, which is the app with its own server. When it cannot, a
 * path from here is never used: the file is sent with uploadFile.
 */
export async function intakeFiles<T extends IncomingFile>(
  files: readonly T[],
  handlers: {
    pathOf: (file: T) => string;
    uploadImage: (file: T) => Promise<ImageAttachment | null>;
    uploadFile?: (file: T) => Promise<FileAttachment | null>;
    sameComputer?: boolean | (() => Promise<boolean>);
    /** Told as a file starts on its way, for a line while it travels. */
    onSending?: (file: T) => void;
  },
): Promise<{ attachments: Attachment[]; refused: string | null }> {
  const attachments: Attachment[] = [];
  const complaints: string[] = [];
  let here: boolean | null = null;
  const sameComputer = async () => {
    if (here !== null) return here;
    const said = handlers.sameComputer ?? true;
    here = typeof said === "boolean" ? said : await said().catch(() => false);
    return here;
  };
  const said = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
  // One at a time, so the chips keep the order the files were chosen in.
  for (const file of files) {
    if (isImage(file)) {
      try {
        const uploaded = await handlers.uploadImage(file);
        if (uploaded) attachments.push(uploaded);
      } catch (error) {
        complaints.push(`${file.name || "image"}: ${said(error, "upload failed")}`);
      }
      continue;
    }
    let path = "";
    let pathless = true;
    try {
      path = handlers.pathOf(file);
      pathless = !path;
    } catch {
      // a plain browser tab has no disk path to give
    }
    // a path on this computer names nothing on a server elsewhere
    if (path && !(await sameComputer())) path = "";
    if (path) {
      attachments.push(fileAttachment(file.name, path, file.size));
      continue;
    }
    // A small text drop with no path anywhere keeps its words inline, as
    // it always has, for the server this app runs.
    const inline = (file.type.startsWith("text/") || file.type === "application/json") && file.size <= INLINE_TEXT_LIMIT;
    if (pathless && inline && (!handlers.uploadFile || (await sameComputer()))) {
      try {
        attachments.push(pasteAttachment(await file.text()));
        continue;
      } catch {
        // unreadable drag; sent instead, or said below
      }
    }
    if (handlers.uploadFile) {
      try {
        handlers.onSending?.(file);
        const sent = await handlers.uploadFile(file);
        if (sent) attachments.push(sent);
      } catch (error) {
        complaints.push(`${file.name || "That file"}: ${said(error, "it could not be sent")}`);
      }
      continue;
    }
    complaints.push(`${file.name || "That file"} can't be attached from here`);
  }
  return { attachments, refused: complaints.length ? complaints.join("; ") : null };
}

type Sendable = Pick<File, "name" | "size" | "type" | "slice">;

/**
 * A file sent to the conversation's server a part at a time, each part
 * its own request, so one of a few megabytes still fits through Bloks
 * Cloud. A part whose answer was lost is sent again; a send that fails
 * is called off so nothing half-sent is left behind. Answers with what
 * the server says it kept.
 */
export async function sendInParts(
  file: Sendable,
  options: { fetcher?: Fetcher; partBytes: number },
): Promise<{ kind: "image"; path: string; mime: string; bytes: number } | { kind: "file"; path: string; name: string; bytes: number }> {
  const fetcher = options.fetcher ?? fetch;
  const call = async (path: string, init: RequestInit) => {
    const response = await fetcher(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // a server older than this app has nowhere to put a file
      const older = body?.code === "unknown_route";
      const words = older ? "the computer this workspace runs on needs an update before it can take files" : (body?.error ?? "it could not be sent");
      throw Object.assign(new Error(words), { status: response.status, older });
    }
    return body;
  };
  const started = await call("/api/attachments/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
  });
  const partSize = typeof started.partSize === "number" && started.partSize > 0 ? started.partSize : options.partBytes;
  try {
    let next = 0;
    // a few at once, as a workspace move does: each is a round trip
    const lane = async () => {
      for (let index = next++; index < started.parts; index = next++) {
        const piece = new Uint8Array(await file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize)).arrayBuffer());
        for (let tries = 1; ; tries++) {
          try {
            await call(`/api/attachments/uploads/${started.id}/${index}`, {
              method: "PUT",
              headers: { "content-type": "application/octet-stream" },
              body: piece,
            });
            break;
          } catch (error) {
            const status = (error as { status?: number }).status ?? 0;
            const again = tries < 4 && (status === 0 || status >= 500 || status === 408 || status === 429);
            if (!again) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400 * tries));
          }
        }
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    return await call(`/api/attachments/uploads/${started.id}/finish`, { method: "POST" });
  } catch (error) {
    void fetcher(`/api/attachments/uploads/${started.id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

/** A file the server cannot open where it lies, sent to it, with the path
 * it landed at. Refused in words, before anything is sent, when it is
 * bigger than the server takes. */
export async function uploadFileAttachment(file: Sendable, fetcher?: Fetcher): Promise<FileAttachment | null> {
  const where = await destination(fetcher);
  if (file.size > where.fileMaxBytes) {
    throw new Error(`it is ${formatBytes(file.size)}, and a file sent to the computer this workspace runs on can be ${formatBytes(where.fileMaxBytes)} at most`);
  }
  const kept = await sendInParts(file, { fetcher, partBytes: where.partBytes });
  return { kind: "file", id: newId(), path: kept.path, name: file.name || ("name" in kept ? kept.name : "file"), bytes: kept.bytes };
}

/** Persist an image server-side; the prompt will carry the saved path.
 * To a server elsewhere it goes in parts, the way any file does, since
 * one request through Bloks Cloud carries well under 10 MB. */
export async function uploadImageAttachment(file: File, fetcher?: Fetcher): Promise<ImageAttachment | null> {
  if (!isImage(file)) return null;
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name || "image"} is over 10 MB`);
  const where = await destination(fetcher);
  if (!where.sameComputer) {
    try {
      const kept = await sendInParts(file, { fetcher, partBytes: where.partBytes });
      if (kept.kind !== "image") throw new Error("it did not arrive as an image");
      return { kind: "image", id: newId(), path: kept.path, name: file.name || "pasted image", bytes: kept.bytes, mime: kept.mime };
    } catch (error) {
      // a server older than this app still takes an image in one piece
      if (!(error as { older?: boolean }).older) throw error;
    }
  }
  const response = await (fetcher ?? fetch)("/api/attachments", {
    method: "POST",
    headers: { "content-type": file.type },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? "upload failed");
  }
  const saved = await response.json();
  return {
    kind: "image",
    id: newId(),
    path: saved.path,
    name: file.name || "pasted image",
    bytes: saved.bytes,
    mime: saved.mime,
  };
}

/**
 * The prompt the agent receives: what was typed, then one block per
 * chip. Tagged blocks rather than fences, because pasted code carries
 * fences of its own and nesting them loses the boundary.
 */
export function composeOutgoing(text: string, attachments: Attachment[]): string {
  const parts = [text.trim()];
  for (const a of attachments) {
    if (a.kind === "paste") parts.push(`<pasted-text>\n${a.text}\n</pasted-text>`);
    else if (a.kind === "image") parts.push(`<attached-image path="${escapeAttr(a.path)}" />`);
    else parts.push(`<attached-file path="${escapeAttr(a.path)}" />`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Paths are untrusted prompt content; a filename full of quotes must
 * stay inside its attribute. */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

const unescapeAttr = (raw: string) =>
  raw
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&amp;", "&");

/** Transcript rendering: the display text with the attachment machinery
 * lifted out, so the bubble shows a thumbnail or a filename chip where
 * the tags would have been. Pasted text stays put; it is real content.
 *
 * A voice message (from Telegram, written by the server) comes back as
 * the path of its audio, and what remains is what it was heard as. */
export function splitAttachments(text: string): {
  display: string;
  images: string[];
  files: string[];
  voice: string[];
} {
  const images: string[] = [];
  const files: string[] = [];
  const voice: string[] = [];
  const display = text
    .replace(/<voice-message\s+path="([^"]*)"(?:\s+note="[^"]*")?\s*\/>\s*/g, (_whole, raw: string) => {
      const path = unescapeAttr(raw);
      if (path) voice.push(path);
      return "";
    })
    .replace(/<attached-image\s+path="([^"]*)"\s*\/>(?:\s*\n)?/g, (_whole, raw: string) => {
      const path = unescapeAttr(raw);
      if (path) images.push(path);
      return "";
    })
    .replace(/<attached-file\s+path="([^"]*)"\s*\/>(?:\s*\n)?/g, (_whole, raw: string) => {
      const path = unescapeAttr(raw);
      if (path) files.push(path);
      return "";
    });
  return { display: display.trim(), images, files, voice };
}

/** The bare filename a saved path ends in, which is what the serving
 * route wants. Both slash directions, for transcripts that crossed OSes. */
export function attachmentBasename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
