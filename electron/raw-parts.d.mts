// Hand-written twin of raw-parts.mjs, so the tests typecheck against the
// same shapes the main process uses.

export const RAW_PARTS_MAX_BYTES: number;

/** One answer to a raw ask, opened; a part says what it is part of. */
export interface RawAnswer<B = Uint8Array> {
  status: number;
  type?: string;
  bytes: B;
  size?: number;
  parts?: number;
  part?: number;
  tag?: string;
}

export function gatherParts<B = Uint8Array>(
  askPart: (part: number, tag?: string) => Promise<RawAnswer<Uint8Array>>,
  options?: {
    join?: (pieces: Uint8Array[], type: string | undefined) => B;
    gone?: () => boolean;
    maxBytes?: number;
  },
): Promise<RawAnswer<B | Uint8Array>>;
