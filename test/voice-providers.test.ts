// Fish Audio, xAI and a Chatterbox server as voices, each against a fake
// of its own on this machine: what each is sent, what each answers, and
// how each refusal is said as the thing to fix. Never a real vendor.
// before anything loads server/config.ts, so nothing lands in ~/.bloks
import "./helpers/own-data.ts";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";

import type { AppConfig } from "../server/config.ts";
import {
  SPEAK_MAX_CHARS,
  isLocalHost,
  listVoices,
  normalizeChatterboxUrl,
  parseBotVoice,
  parseChatterboxVoices,
  parseFishModels,
  speak,
  speechConfigured,
  speechError,
  xaiKey,
} from "../server/speech.ts";
import { startHarness } from "./helpers/server.ts";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** A fake vendor: every request it hears, and a handler that answers. */
async function fakeVendor(handle: (seen: Seen, res: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const one = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      seen.push(one);
      handle(one, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 1, 2, 3, 4]);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Runs with the hosted vendors pointed at a fake, as the harness does. */
async function withBase<T>(name: "BLOKS_FISH_AUDIO_URL" | "BLOKS_XAI_SPEECH_URL", url: string, fn: () => Promise<T>): Promise<T> {
  const was = process.env[name];
  process.env[name] = url;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env[name];
    else process.env[name] = was;
  }
}

describe("Fish Audio", () => {
  test("speaks by streaming /v1/tts with the key, the voice and mp3", async () => {
    const fake = await fakeVendor((_seen, res) => {
      res.writeHead(200, { "content-type": "audio/mpeg", "transfer-encoding": "chunked" });
      res.write(MP3.subarray(0, 4));
      res.end(MP3.subarray(4));
    });
    try {
      const cfg: AppConfig = { speech: { fishKey: "fish-test" } };
      const long = "word ".repeat(1_000);
      const out = await withBase("BLOKS_FISH_AUDIO_URL", fake.url, () => speak(cfg, { provider: "fish", id: "voice-123" }, long));
      assert.equal(out.mime, "audio/mpeg");
      assert.deepEqual(await bytes(out.stream), MP3);
      const [call] = fake.seen;
      assert.equal(call.method, "POST");
      assert.equal(call.url, "/v1/tts");
      assert.equal(call.headers.authorization, "Bearer fish-test");
      assert.match(String(call.headers["content-type"]), /application\/json/);
      const sent = JSON.parse(call.body);
      assert.equal(sent.reference_id, "voice-123");
      assert.equal(sent.format, "mp3");
      assert.equal(sent.latency, "balanced");
      assert.equal(sent.text.length, SPEAK_MAX_CHARS, "billed per character, so capped");
    } finally {
      await fake.close();
    }
  });

  test("each refusal says what to fix", async () => {
    const answers: Record<string, [number, unknown]> = {
      key: [401, { status: 401, message: "Invalid token" }],
      money: [402, { status: 402, message: "Insufficient balance" }],
      gone: [404, { status: 404, message: "Model not found" }],
      busy: [503, { status: 503, message: "High load" }],
    };
    const fake = await fakeVendor((seen, res) => {
      const which = JSON.parse(seen.body).reference_id as string;
      const [status, body] = answers[which];
      json(res, status, body);
    });
    try {
      const said = async (which: string) => {
        try {
          await withBase("BLOKS_FISH_AUDIO_URL", fake.url, () => speak({ speech: { fishKey: "k" } }, { provider: "fish", id: which }, "Hi"));
        } catch (e) {
          return (e as Error).message;
        }
        return "";
      };
      assert.match(await said("key"), /Fish Audio did not accept the key\. Paste a new one in Settings, Voices\./);
      assert.match(await said("money"), /no credit left\. Add some at fish\.audio/);
      assert.match(await said("gone"), /no voice by that ID any more\. Pick another/);
      assert.match(await said("busy"), /not answering properly right now \(High load\)/);
    } finally {
      await fake.close();
    }
    await assert.rejects(speak({}, { provider: "fish", id: "x" }, "Hi"), /No Fish Audio key is saved\. Add one in Settings, Voices\./);
  });

  test("lists the person's own voices first, then popular ones, once each and only those that speak", async () => {
    const fake = await fakeVendor((seen, res) => {
      const self = seen.url.includes("self=true");
      json(res, 200, {
        total: 2,
        items: self
          ? [
              { _id: "mine-1", title: "My clone", type: "tts" },
              { _id: "convert", title: "A converter", type: "svc" },
            ]
          : [
              { _id: "pop-1", title: "Narrator", type: "tts" },
              { _id: "mine-1", title: "My clone", type: "tts" },
            ],
      });
    });
    try {
      const voices = await withBase("BLOKS_FISH_AUDIO_URL", fake.url, () => listVoices({ speech: { fishKey: "fish-test" } }));
      assert.deepEqual(
        voices.filter((v) => v.provider === "fish").map((v) => v.id),
        ["mine-1", "pop-1"],
      );
      assert.ok(fake.seen.every((s) => s.method === "GET" && s.url.startsWith("/model?") && s.headers.authorization === "Bearer fish-test"));
      assert.ok(fake.seen.some((s) => /self=true/.test(s.url)));
      assert.ok(fake.seen.some((s) => /sort_by=score/.test(s.url)));
    } finally {
      await fake.close();
    }
    assert.deepEqual(parseFishModels({ items: [{ _id: "a", title: " Spaced " }, { title: "no id" }] }), [
      { provider: "fish", id: "a", name: "Spaced" },
    ]);
  });
});

describe("xAI", () => {
  test("speaks with its own key when one is saved, and decodes a JSON clip", async () => {
    const fake = await fakeVendor((_seen, res) => json(res, 200, { audio: MP3.toString("base64"), content_type: "audio/mpeg", duration: 0.4 }));
    try {
      const cfg: AppConfig = { speech: { xaiKey: "xai-speech" }, providers: { grok: { key: "xai-grok" } } };
      const out = await withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => speak(cfg, { provider: "xai", id: "ara" }, "Hello there"));
      assert.equal(out.mime, "audio/mpeg");
      assert.deepEqual(await bytes(out.stream), MP3);
      const [call] = fake.seen;
      assert.equal(call.url, "/v1/tts");
      assert.equal(call.headers.authorization, "Bearer xai-speech");
      assert.deepEqual(JSON.parse(call.body), {
        text: "Hello there",
        voice_id: "ara",
        language: "auto",
        output_format: { codec: "mp3" },
      });
    } finally {
      await fake.close();
    }
  });

  test("falls back to the Grok engine's key, takes raw audio, and blames the right key when refused", async () => {
    let refuse = false;
    const fake = await fakeVendor((_seen, res) => {
      if (refuse) return json(res, 401, { error: "Incorrect API key provided" });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(MP3);
    });
    try {
      const cfg: AppConfig = { providers: { grok: { key: "xai-grok" } } };
      assert.deepEqual(xaiKey(cfg), { key: "xai-grok", source: "grok" });
      assert.deepEqual(xaiKey({ xai: { key: "legacy" } }), { key: "legacy", source: "grok" });
      assert.equal(speechConfigured(cfg).xaiSource, "grok");
      const out = await withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => speak(cfg, { provider: "xai", id: "eve" }, "Hi"));
      assert.deepEqual(await bytes(out.stream), MP3);
      assert.equal(fake.seen[0].headers.authorization, "Bearer xai-grok");
      refuse = true;
      await assert.rejects(
        withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => speak(cfg, { provider: "xai", id: "eve" }, "Hi")),
        /did not accept the Grok key used for speech\. Replace it in Settings, Engines/,
      );
      await assert.rejects(
        withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => speak({ speech: { xaiKey: "own" } }, { provider: "xai", id: "eve" }, "Hi")),
        /xAI did not accept the key\. Paste a new one in Settings, Voices\./,
      );
    } finally {
      await fake.close();
    }
    await assert.rejects(speak({}, { provider: "xai", id: "eve" }, "Hi"), /No xAI key is saved/);
  });

  test("lists voices from /v1/tts/voices, or its documented five when that fails", async () => {
    let broken = false;
    const fake = await fakeVendor((_seen, res) =>
      broken ? json(res, 500, { error: "down" }) : json(res, 200, { voices: [{ voice_id: "eve", name: "Eve", language: "en" }, { voice_id: "grace", name: "Grace" }] }),
    );
    try {
      const cfg: AppConfig = { speech: { xaiKey: "k" } };
      const listed = await withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => listVoices(cfg));
      assert.deepEqual(
        listed.filter((v) => v.provider === "xai"),
        [
          { provider: "xai", id: "eve", name: "Eve (en)" },
          { provider: "xai", id: "grace", name: "Grace" },
        ],
      );
      assert.equal(fake.seen[0].url, "/v1/tts/voices");
      assert.equal(fake.seen[0].headers.authorization, "Bearer k");
      broken = true;
      const fallback = await withBase("BLOKS_XAI_SPEECH_URL", fake.url, () => listVoices(cfg));
      assert.deepEqual(
        fallback.filter((v) => v.provider === "xai").map((v) => v.id),
        ["eve", "ara", "leo", "rex", "sal"],
      );
    } finally {
      await fake.close();
    }
  });
});

describe("Chatterbox", () => {
  test("an address has to be this computer or its network", () => {
    assert.deepEqual(normalizeChatterboxUrl("localhost:4123"), { url: "http://localhost:4123" });
    assert.deepEqual(normalizeChatterboxUrl("http://127.0.0.1:8004/v1/audio/speech"), { url: "http://127.0.0.1:8004" });
    assert.deepEqual(normalizeChatterboxUrl("http://192.168.1.20:4123/"), { url: "http://192.168.1.20:4123" });
    assert.deepEqual(normalizeChatterboxUrl("http://studio.local:4123/v1"), { url: "http://studio.local:4123" });
    assert.deepEqual(normalizeChatterboxUrl("http://[::1]:4123"), { url: "http://[::1]:4123" });
    assert.match((normalizeChatterboxUrl("https://tts.example.com") as any).error, /this computer or your own network/);
    assert.match((normalizeChatterboxUrl("http://8.8.8.8:4123") as any).error, /this computer or your own network/);
    assert.match((normalizeChatterboxUrl("http://me:pw@localhost:4123") as any).error, /name and password/);
    assert.match((normalizeChatterboxUrl("ftp://localhost") as any).error, /http/);
    assert.match((normalizeChatterboxUrl("") as any).error, /address/);
    for (const host of ["10.0.0.4", "172.20.1.1", "169.254.3.3", "100.101.102.103", "fd12::1", "fe80::1", "mini", "nas.lan", "box.ts.net"]) {
      assert.equal(isLocalHost(host), true, host);
    }
    for (const host of ["172.32.0.1", "1.1.1.1", "example.com", "2001:db8::1"]) assert.equal(isLocalHost(host), false, host);
  });

  test("speaks through /v1/audio/speech, naming a voice only when it is not the default", async () => {
    const fake = await fakeVendor((_seen, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(MP3);
    });
    try {
      const cfg: AppConfig = { speech: { chatterboxUrl: fake.url } };
      const first = await speak(cfg, { provider: "chatterbox", id: "default" }, "Hello");
      assert.equal(first.mime, "audio/wav");
      assert.deepEqual(await bytes(first.stream), MP3);
      await bytes((await speak(cfg, { provider: "chatterbox", id: "narrator.wav" }, "Again")).stream);
      const [plain, named] = fake.seen.map((s) => ({ url: s.url, body: JSON.parse(s.body), auth: s.headers.authorization }));
      assert.equal(plain.url, "/v1/audio/speech");
      assert.deepEqual(plain.body, { model: "chatterbox", input: "Hello", response_format: "mp3" });
      assert.equal(plain.auth, undefined, "no key goes to a server of one's own");
      assert.equal(named.body.voice, "narrator.wav");
    } finally {
      await fake.close();
    }
  });

  test("a wrong address, a server that is down and a failed voice each say what to fix", async () => {
    const fake = await fakeVendor((seen, res) => {
      if (seen.url !== "/v1/audio/speech") return json(res, 404, { detail: "Not Found" });
      json(res, 422, { detail: "Voice file not found" });
    });
    const notChatterbox = await fakeVendor((_seen, res) => json(res, 404, { detail: "Not Found" }));
    try {
      await assert.rejects(
        speak({ speech: { chatterboxUrl: fake.url } }, { provider: "chatterbox", id: "gone.wav" }, "Hi"),
        /Chatterbox could not use that voice or text \(Voice file not found\)/,
      );
      await assert.rejects(
        speak({ speech: { chatterboxUrl: notChatterbox.url } }, { provider: "chatterbox", id: "default" }, "Hi"),
        new RegExp(`${notChatterbox.url.replace(/[.]/g, "\\.")} answered, but not as a Chatterbox server`),
      );
    } finally {
      await fake.close();
      await notChatterbox.close();
    }
    // the fake is closed now, so nothing listens there
    await assert.rejects(
      speak({ speech: { chatterboxUrl: fake.url } }, { provider: "chatterbox", id: "default" }, "Hi"),
      /Nothing answered at http:\/\/127\.0\.0\.1:\d+\. Start the Chatterbox server, or check the address in Settings, Voices\./,
    );
    await assert.rejects(speak({}, { provider: "chatterbox", id: "default" }, "Hi"), /No Chatterbox server is set/);
  });

  test("its voices come from whichever list route the server has, with its default first", async () => {
    const fake = await fakeVendor((seen, res) => {
      if (seen.url === "/get_predefined_voices") return json(res, 200, [{ display_name: "Emily", filename: "Emily.wav" }]);
      json(res, 404, { detail: "Not Found" });
    });
    try {
      const voices = (await listVoices({ speech: { chatterboxUrl: fake.url } })).filter((v) => v.provider === "chatterbox");
      assert.deepEqual(voices, [
        { provider: "chatterbox", id: "default", name: "Default" },
        { provider: "chatterbox", id: "Emily.wav", name: "Emily" },
      ]);
      assert.deepEqual(fake.seen.map((s) => s.url), ["/v1/audio/voices", "/voices", "/get_predefined_voices"]);
    } finally {
      await fake.close();
    }
    const down = (await listVoices({ speech: { chatterboxUrl: fake.url } })).filter((v) => v.provider === "chatterbox");
    assert.deepEqual(down.map((v) => v.id), ["default"], "a server that is down still offers its default");
    assert.deepEqual(parseChatterboxVoices({ voices: [{ name: "calm.wav" }, "bright"] }).map((v) => [v.id, v.name]), [
      ["calm.wav", "calm"],
      ["bright", "bright"],
    ]);
    assert.deepEqual(parseChatterboxVoices({ data: [{ id: "x", name: "X voice" }] }).map((v) => v.name), ["X voice"]);
  });
});

test("an agent's voice can be any of the vendors, and nothing else", () => {
  for (const provider of ["elevenlabs", "openai", "fish", "xai", "chatterbox", "system"]) {
    assert.equal(parseBotVoice({ provider, id: "v" })?.provider, provider);
  }
  assert.equal(parseBotVoice({ provider: "somewhere", id: "v" }), undefined);
  assert.equal(parseBotVoice({ provider: "fish", id: "" }), undefined);
  assert.equal(parseBotVoice(null), null);
});

test("an error body is quoted short, and never as a page of HTML", () => {
  assert.match(speechError("fish", 400, "<html><body>Bad</body></html>"), /^Fish Audio refused to speak: 400\.$/);
  assert.match(speechError("xai", 429, "{}"), /limiting requests/);
  assert.match(speechError("xai", 400, JSON.stringify({ error: "insufficient credits on team" })), /out of credits\. Add some at console\.x\.ai/);
});

describe("through the app", () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  let chatterbox: Awaited<ReturnType<typeof fakeVendor>>;
  before(async () => {
    chatterbox = await fakeVendor((seen, res) => {
      if (seen.url === "/v1/audio/speech") {
        res.writeHead(200, { "content-type": "audio/wav" });
        return res.end(MP3);
      }
      json(res, 200, { voices: [{ name: "calm.wav" }] });
    });
    h = await startHarness();
  });
  after(async () => {
    await h.stop();
    await chatterbox.close();
  });

  test("keys are saved but never shown, and a public Chatterbox address is refused", async () => {
    const public_ = await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ speech: { chatterboxUrl: "https://tts.example.com" } }) });
    assert.equal(public_.status, 400);
    assert.match((await public_.json()).error, /this computer or your own network/);
    const saved = await h.json("/api/config", {
      method: "PUT",
      body: JSON.stringify({ speech: { fishKey: "fish-secret-123", xaiKey: "xai-secret-456", chatterboxUrl: `${chatterbox.url}/v1/audio/speech` } }),
    });
    assert.equal(saved.speech.fish, true);
    assert.equal(saved.speech.xai, true);
    assert.equal(saved.speech.xaiSource, "speech");
    assert.equal(saved.speech.chatterbox, true);
    assert.equal(saved.speech.chatterboxUrl, chatterbox.url, "the pasted endpoint is folded to the root");
    const shown = JSON.stringify(await h.json("/api/config"));
    assert.ok(!shown.includes("fish-secret-123") && !shown.includes("xai-secret-456"), "a key never goes back to a screen");
    const voices = (await h.json("/api/speech/voices")).voices;
    assert.ok(voices.some((v: any) => v.provider === "chatterbox" && v.id === "calm.wav"));
  });

  test("an agent speaks in its Chatterbox voice, the markdown read as words", async () => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Reader" }) });
    const patched = await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ voice: { provider: "chatterbox", id: "calm.wav", name: "calm" } }) });
    assert.equal(patched.bot.voice.provider, "chatterbox");
    const res = await h.fetch(`/api/bots/${bot.id}/speak`, { method: "POST", body: JSON.stringify({ text: "**Done.** See `notes.md` for [the list](https://example.com)." }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), MP3);
    const said = JSON.parse(chatterbox.seen.filter((s) => s.url === "/v1/audio/speech").at(-1)!.body);
    assert.equal(said.voice, "calm.wav");
    assert.doesNotMatch(said.input, /\*\*|`|\]\(/);
    assert.match(said.input, /Done\./);
  });

  test("a vendor that refuses comes back as a 502 that says what to fix", async () => {
    const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Fishy" }) });
    await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ voice: { provider: "fish", id: "v1" } }) });
    // the harness points Fish Audio at a port nobody listens on
    const res = await h.fetch(`/api/bots/${bot.id}/speak`, { method: "POST", body: JSON.stringify({ text: "Hello" }) });
    assert.equal(res.status, 502);
    const { error } = await res.json();
    assert.match(error, /Fish Audio could not be reached\. Check the internet connection/);
    assert.ok(!error.includes("fish-secret-123"));
  });
});
