// A pairing link for the owner of a hosted workspace, asked for through
// Bloks Cloud (server/owner-link.ts): the question has to be signed with
// the licence and fresh, and the answer has to open for the app that
// asked and nobody else, including an app that is a browser page or an
// iPhone rather than Node, which is why one side here is WebCrypto.
import { test } from "node:test";
import assert from "node:assert/strict";

import { LINK_ASK_WINDOW_MS, linkAskMac, linkAskValid, readOwnerLink, REQUESTER_KEY, requesterKey, sealForRequester } from "../server/owner-link.ts";

const LICENCE = `blok_live_${"ab".repeat(16)}`;

test("a question is good only signed with the licence, about this key, and fresh", () => {
  const { key } = requesterKey();
  assert.match(key, REQUESTER_KEY);
  const at = Date.now();
  const mac = linkAskMac(LICENCE, key, at);
  assert.equal(linkAskValid(LICENCE, { key, at, mac }), true);
  assert.equal(linkAskValid(`blok_live_${"cd".repeat(16)}`, { key, at, mac }), false, "another licence");
  assert.equal(linkAskValid(null, { key, at, mac }), false, "a workspace with no licence answers nobody");
  assert.equal(linkAskValid(LICENCE, { key: requesterKey().key, at, mac }), false, "another app's key");
  assert.equal(linkAskValid(LICENCE, { key, at: at + 1, mac }), false, "another time");
  const old = at - LINK_ASK_WINDOW_MS - 1;
  assert.equal(linkAskValid(LICENCE, { key, at: old, mac: linkAskMac(LICENCE, key, old) }), false, "stale");
  assert.equal(linkAskValid(LICENCE, { key: "short", at, mac }), false);
  assert.equal(linkAskValid(LICENCE, { key, at, mac: "zz" }), false);
});

test("the answer opens for the app that asked, and for nobody else", () => {
  const asker = requesterKey();
  const link = { link: "https://bloks.dev/pair#abc_DEF-123", webLink: "https://bloks.dev/web/#abc_DEF-123", expiresAt: 1_900_000_000_000, host: "Sam" };
  const sealed = sealForRequester(asker.key, link);
  assert.equal(sealed.v, 1);
  for (const field of [sealed.k, sealed.n, sealed.c]) assert.match(field, /^[A-Za-z0-9_-]+$/, "base64url throughout");
  assert.ok(!JSON.stringify(sealed).includes("pair#"), "nothing of the link can be read on the way");
  assert.deepEqual(asker.open(sealed), link);
  assert.equal(requesterKey().open(sealed), null, "another app's key opens nothing");
  assert.equal(asker.open({ ...sealed, c: sealed.c.slice(0, -2) + (sealed.c.endsWith("A") ? "BA" : "AA") }), null, "a changed byte opens nothing");
  assert.throws(() => sealForRequester("B" + "A".repeat(86), link), "a key that is not a point on the curve is refused");
});

test("a browser or an iPhone opens it with what it has: P-256, HKDF-SHA256 and AES-GCM", async () => {
  const subtle = globalThis.crypto.subtle;
  const pair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])) as CryptoKeyPair;
  const raw = Buffer.from(await subtle.exportKey("raw", pair.publicKey));
  assert.equal(raw.length, 65);
  const key = raw.toString("base64url");
  assert.match(key, REQUESTER_KEY);

  const sealed = sealForRequester(key, { link: "https://bloks.dev/pair#xyz", webLink: null, expiresAt: 1, host: "" });
  const hostKey = await subtle.importKey("raw", Buffer.from(sealed.k, "base64url"), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: hostKey }, pair.privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("bloks-hosted-link-v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(sealed.n, "base64url") }, aes, Buffer.from(sealed.c, "base64url"));
  assert.deepEqual(JSON.parse(Buffer.from(plain).toString("utf8")), { link: "https://bloks.dev/pair#xyz", webLink: null, expiresAt: 1, host: "" });
});

test("only a pairing link in the expected shape is kept", () => {
  assert.deepEqual(readOwnerLink({ link: "https://bloks.dev/pair#a1", expiresAt: 5, host: "Sam\u0007" }), {
    link: "https://bloks.dev/pair#a1",
    webLink: null,
    expiresAt: 5,
    host: "Sam",
  });
  assert.ok(readOwnerLink({ link: "http://127.0.0.1:4000/pair#a1", expiresAt: 5 }), "a test's stand-in for the site");
  for (const link of ["http://bloks.dev/pair#a1", "https://bloks.dev/pair", "javascript:alert(1)#a", "https://bloks.dev/pair#a b"]) {
    assert.equal(readOwnerLink({ link, expiresAt: 5 }), null, link);
  }
  assert.equal(readOwnerLink({ link: "https://bloks.dev/pair#a1" }), null, "no expiry");
});
