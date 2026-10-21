// A workspace file arriving in parts, for a workspace reached through
// Bloks Cloud.
//
// A move file is the whole workspace, usually hundreds of megabytes, and
// Bloks Cloud carries one request of about a megabyte at a time, sealed
// for one device. So the app sends the file in numbered parts, each its
// own sealed request, a few at once, and this keeps them: written into
// place as they come, with a note of which have arrived, so a part lost on
// the way is sent again on its own and a send that stopped (a closed
// window, a dropped line, a machine that slept) carries on from where it
// was rather than from the start. When every part is here, the file is
// handed over exactly as a whole upload would have been.
//
// One upload at a time: starting another sets the last one aside. Parts
// are kept on disk beside the backups, never in memory, and an upload
// nobody has touched for a day is cleared away.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** Each part, but the last. Small enough that a part, sealed and wrapped
 * for the trip, stays well under what Bloks Cloud carries in one request
 * (it is about 2.4 times the size by then), and large enough that a
 * workspace of a few hundred megabytes is a few hundred parts. */
export const PART_BYTES = 384 * 1024;
/** An upload nobody has added to for this long is given up. */
export const UPLOAD_IDLE_MS = 24 * 60 * 60_000;

export interface UploadState {
  id: string;
  size: number;
  partSize: number;
  parts: number;
  /** One bit per part, set once it has arrived. */
  have: Buffer;
  updatedAt: number;
}

export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ID = /^up_[A-Za-z0-9_-]{12}$/;

export class MoveUploads {
  private readonly dir: () => string;
  private readonly now: () => number;
  private readonly maxBytes: number;

  constructor(opts: { dir: () => string; maxBytes: number; now?: () => number }) {
    this.dir = opts.dir;
    this.maxBytes = opts.maxBytes;
    this.now = opts.now ?? Date.now;
  }

  private dataFile(id: string) {
    return join(this.dir(), `upload-${id}.part`);
  }
  private stateFile(id: string) {
    return join(this.dir(), `upload-${id}.json`);
  }

  private read(id: string): UploadState | null {
    if (!ID.test(id)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile(id), "utf8")) as Omit<UploadState, "have"> & { have: string };
      if (raw.id !== id || !existsSync(this.dataFile(id))) return null;
      return { ...raw, have: Buffer.from(raw.have, "base64") };
    } catch {
      return null;
    }
  }

  private write(state: UploadState) {
    const temp = `${this.stateFile(state.id)}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...state, have: state.have.toString("base64") }), { mode: 0o600 });
    renameSync(temp, this.stateFile(state.id));
  }

  /** Begins one, setting any other aside. The file is made at its full
   * size up front, so each part is written straight into its place. */
  start(size: unknown): { id: string; partSize: number; parts: number } {
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) throw new UploadError("Say how big the file is, in bytes.", 400);
    if (size > this.maxBytes) throw new UploadError("That file is bigger than a workspace move can be.", 413);
    mkdirSync(this.dir(), { recursive: true, mode: 0o700 });
    this.clear();
    const id = `up_${randomBytes(9).toString("base64url")}`;
    const parts = Math.ceil(size / PART_BYTES);
    const fd = openSync(this.dataFile(id), "wx", 0o600);
    try {
      // sparse where the file system allows: no bytes are written yet
      writeSync(fd, Buffer.alloc(1), 0, 1, size - 1);
    } finally {
      closeSync(fd);
    }
    this.write({ id, size, partSize: PART_BYTES, parts, have: Buffer.alloc(Math.ceil(parts / 8)), updatedAt: this.now() });
    return { id, partSize: PART_BYTES, parts };
  }

  /** Where an upload is: how many parts, and which are still to come. */
  status(id: string): { id: string; size: number; partSize: number; parts: number; received: number; missing: number[] } | null {
    const state = this.read(id);
    if (!state) return null;
    const missing: number[] = [];
    for (let i = 0; i < state.parts; i++) if (!has(state.have, i)) missing.push(i);
    return { id, size: state.size, partSize: state.partSize, parts: state.parts, received: state.parts - missing.length, missing };
  }

  /** Puts one part in its place. A part sent twice is written twice, to
   * the same bytes, which is what a retry after a lost answer does. Every
   * step is synchronous, so parts arriving side by side never interleave
   * between reading the note and writing it back. */
  put(id: string, index: number, bytes: Buffer): { received: number; parts: number } {
    const state = this.read(id);
    if (!state) throw new UploadError("That upload is not here any more. Start the move again.", 404);
    if (!Number.isInteger(index) || index < 0 || index >= state.parts) throw new UploadError("There is no such part.", 400);
    const want = index === state.parts - 1 ? state.size - index * state.partSize : state.partSize;
    if (bytes.length !== want) throw new UploadError(`Part ${index} should be ${want} bytes and was ${bytes.length}.`, 400);
    const fd = openSync(this.dataFile(id), "r+");
    try {
      writeSync(fd, bytes, 0, bytes.length, index * state.partSize);
    } finally {
      closeSync(fd);
    }
    state.have[index >> 3] |= 1 << (index & 7);
    state.updatedAt = this.now();
    this.write(state);
    let received = 0;
    for (let i = 0; i < state.parts; i++) if (has(state.have, i)) received++;
    return { received, parts: state.parts };
  }

  /** Where the file is gathering, for reading it before it is finished
   * (its first bytes say whether it is sealed), or null. */
  file(id: string): string | null {
    return this.read(id) ? this.dataFile(id) : null;
  }

  /** The whole file, moved to `to`, once every part is here. */
  finish(id: string, to: string): void {
    const status = this.status(id);
    if (!status) throw new UploadError("That upload is not here any more. Start the move again.", 404);
    if (status.missing.length) throw new UploadError(`${status.missing.length} of ${status.parts} parts have not arrived yet.`, 409);
    if (statSync(this.dataFile(id)).size !== status.size) throw new UploadError("The file that arrived is not the size it was said to be.", 409);
    renameSync(this.dataFile(id), to);
    rmSync(this.stateFile(id), { force: true });
  }

  cancel(id: string): boolean {
    if (!ID.test(id) || !existsSync(this.stateFile(id))) return false;
    rmSync(this.dataFile(id), { force: true });
    rmSync(this.stateFile(id), { force: true });
    return true;
  }

  /** Every upload set aside, or only those idle past UPLOAD_IDLE_MS. */
  clear(onlyIdle = false): number {
    let names: string[];
    try {
      names = readdirSync(this.dir());
    } catch {
      return 0;
    }
    let cleared = 0;
    for (const name of names) {
      const m = /^upload-(up_[A-Za-z0-9_-]{12})\.json$/.exec(name);
      if (!m) continue;
      const state = this.read(m[1]);
      if (onlyIdle && state && this.now() - state.updatedAt < UPLOAD_IDLE_MS) continue;
      rmSync(this.dataFile(m[1]), { force: true });
      rmSync(this.stateFile(m[1]), { force: true });
      cleared++;
    }
    // a part file whose note is gone is nothing anybody can finish
    for (const name of names) {
      const m = /^upload-(up_[A-Za-z0-9_-]{12})\.part$/.exec(name);
      if (m && !existsSync(this.stateFile(m[1]))) rmSync(join(this.dir(), name), { force: true });
    }
    return cleared;
  }
}

function has(bits: Buffer, i: number): boolean {
  return ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}
