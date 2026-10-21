// A pairing link for the owner of a workspace that has no screen of its
// own, asked for through Bloks Cloud rather than at a terminal.
//
// A hosted workspace runs on a machine nobody sits at, so `bloks-server
// pair` (which prints a link on that machine's terminal) is no way in for
// its owner. Instead the owner's app asks Bloks Cloud, with the licence the
// workspace was activated with, and Bloks Cloud hands the question to the
// workspace on the line it already holds. The workspace makes an ordinary
// pairing link (server/pairing.ts) and answers with it sealed for the app
// that asked, so the link is readable there and nowhere on the way.
//
// Two things keep this from being a door for anybody else:
//
//   The question is signed with the licence key, which the owner, this
//   workspace and Bloks Cloud hold, and a paired phone or a member of a
//   shared room does not. A request dressed up as one by anybody holding
//   only a relay token is refused here, whatever the relay let through.
//   It is fresh for two minutes and is answered once.
//
//   The answer is sealed with a key agreed with the app's own one-time
//   key (ECDH on P-256, then HKDF-SHA256 and AES-256-GCM, which a browser,
//   an iPhone and Node all have), so the relay carries ciphertext only.
//
// Only a hosted workspace answers at all: a Mac's owner is at the Mac, and
// pairs there.
import { createCipheriv, createDecipheriv, createECDH, createHmac, hkdfSync, randomBytes, timingSafeEqual, type ECDH } from "node:crypto";

/** The version of the whole scheme, in every derived key and signature. */
const INFO = "bloks-hosted-link-v1";
/** How far the question's time may be from now. */
export const LINK_ASK_WINDOW_MS = 120_000;

/** A requester's public key: an uncompressed P-256 point (65 bytes, 0x04
 * then X and Y), base64url without padding, which is 87 characters that
 * always start with B. */
export const REQUESTER_KEY = /^B[A-Za-z0-9_-]{86}$/;

const b64u = (bytes: Buffer) => bytes.toString("base64url");

/** The signature on a question: HMAC-SHA256 with the licence key over the
 * requester's key and the time, hex. */
export function linkAskMac(licence: string, key: string, at: number): string {
  return createHmac("sha256", licence).update(`${INFO}:${key}:${at}`).digest("hex");
}

/** Whether a question is signed by the licence and fresh. */
export function linkAskValid(licence: string | null, ask: { key?: unknown; at?: unknown; mac?: unknown }, now = Date.now()): ask is { key: string; at: number; mac: string } {
  if (!licence) return false;
  if (typeof ask.key !== "string" || !REQUESTER_KEY.test(ask.key)) return false;
  if (typeof ask.at !== "number" || !Number.isFinite(ask.at) || Math.abs(now - ask.at) > LINK_ASK_WINDOW_MS) return false;
  if (typeof ask.mac !== "string" || !/^[0-9a-f]{64}$/.test(ask.mac)) return false;
  const want = Buffer.from(linkAskMac(licence, ask.key, ask.at), "hex");
  return timingSafeEqual(want, Buffer.from(ask.mac, "hex"));
}

/** What travels back: this side's one-time public key, a nonce, and the
 * ciphertext with its tag on the end, all base64url. */
export interface SealedLink {
  v: 1;
  k: string;
  n: string;
  c: string;
}

function sharedKey(ecdh: ECDH, peer: string): Buffer {
  const secret = ecdh.computeSecret(Buffer.from(peer, "base64url"));
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), INFO, 32));
}

/** Seals a value for the holder of a requester key. Throws for a key that
 * is not a point on the curve. */
export function sealForRequester(requesterKey: string, value: unknown): SealedLink {
  if (!REQUESTER_KEY.test(requesterKey)) throw new Error("not a requester key");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const key = sharedKey(ecdh, requesterKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, k: b64u(ecdh.getPublicKey()), n: b64u(nonce), c: b64u(body) };
}

/** A one-time key for asking. Keep `open` to read the answer. */
export function requesterKey(): { key: string; open: (sealed: unknown) => unknown | null } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { key: b64u(ecdh.getPublicKey()), open: (sealed) => openSealed(ecdh, sealed) };
}

function openSealed(ecdh: ECDH, sealed: unknown): unknown | null {
  const s = sealed as Partial<SealedLink> | null;
  if (!s || s.v !== 1 || typeof s.k !== "string" || typeof s.n !== "string" || typeof s.c !== "string") return null;
  try {
    const key = sharedKey(ecdh, s.k);
    const nonce = Buffer.from(s.n, "base64url");
    const blob = Buffer.from(s.c, "base64url");
    if (nonce.length !== 12 || blob.length <= 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(blob.subarray(blob.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(blob.subarray(0, blob.length - 16)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

/** The link as the app keeps it: an https pairing link, a browser one,
 * when it lapses and whose it is. Null for anything else. */
export interface OwnerLink {
  link: string;
  webLink: string | null;
  expiresAt: number;
  host: string;
}

/** https, or http on this computer's loopback (a test's stand-in for the
 * site), with the pairing after the #. */
const LINK = /^(?:https:\/\/|http:\/\/127\.0\.0\.1(?::\d+)?\/)[^\s#]*#[A-Za-z0-9_-]+$/;

export function readOwnerLink(value: unknown): OwnerLink | null {
  const v = value as Partial<OwnerLink> | null;
  if (!v || typeof v.link !== "string" || !LINK.test(v.link) || v.link.length > 4096) return null;
  if (typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt)) return null;
  const web = typeof v.webLink === "string" && LINK.test(v.webLink) && v.webLink.length <= 4096 ? v.webLink : null;
  const host = typeof v.host === "string" ? v.host.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) : "";
  return { link: v.link, webLink: web, expiresAt: v.expiresAt, host };
}
