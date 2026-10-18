// Finding a model server that is already running.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { OLLAMA_URL, ollamaUrl, probeOllama, shouldAdopt, type LocalModels } from "../server/local-models.ts";
import type { AppConfig } from "../server/config.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const answers = (body: unknown, ok = true) => {
  globalThis.fetch = (async () => ({ ok, json: async () => body }) as unknown as Response) as typeof fetch;
};

describe("probeOllama", () => {
  test("a running Ollama reports what it has pulled", async () => {
    answers({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] });
    assert.deepEqual(await probeOllama(), { running: true, models: ["llama3.2", "qwen2.5"] });
  });

  test("answering with nothing pulled is not running, because it is not usable", async () => {
    answers({ data: [] });
    assert.deepEqual(await probeOllama(), { running: false, models: [] });
  });

  test("a refused connection is simply not running", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    assert.deepEqual(await probeOllama(), { running: false, models: [] });
  });

  test("an error status is not running", async () => {
    answers({ data: [{ id: "x" }] }, false);
    assert.equal((await probeOllama()).running, false);
  });

  test("junk in the list is dropped rather than shown", async () => {
    answers({ data: [{ id: "good" }, { id: 7 }, {}] });
    assert.deepEqual((await probeOllama()).models, ["good"]);
  });
});

describe("shouldAdopt", () => {
  const found: LocalModels = { running: true, models: ["llama3.2"] };

  test("connects it when nothing is configured", () => {
    assert.equal(shouldAdopt({} as AppConfig, found), true);
  });

  test("never over an existing entry, including one somebody emptied", () => {
    assert.equal(shouldAdopt({ providers: { ollama: {} } } as AppConfig, found), false);
    assert.equal(
      shouldAdopt({ providers: { ollama: { url: "http://10.0.0.2:11434/v1" } } } as AppConfig, found),
      false,
    );
  });

  test("nothing running means nothing to connect", () => {
    assert.equal(shouldAdopt({} as AppConfig, { running: false, models: [] }), false);
  });
});

describe("ollamaUrl (GitHub 309)", () => {
  test("unset, empty or blank keeps this machine's default", () => {
    assert.equal(ollamaUrl({}), OLLAMA_URL);
    assert.equal(ollamaUrl({ OLLAMA_HOST: "" }), OLLAMA_URL);
    assert.equal(ollamaUrl({ OLLAMA_HOST: "   " }), OLLAMA_URL);
  });

  test("the forms Ollama accepts, read the way Ollama reads them", () => {
    const cases: Array<[string, string]> = [
      ["gpu-box.local", "http://gpu-box.local:11434"],
      ["192.168.1.40", "http://192.168.1.40:11434"],
      ["192.168.1.40:8080", "http://192.168.1.40:8080"],
      [":9999", "http://127.0.0.1:9999"],
      ["0.0.0.0", "http://0.0.0.0:11434"],
      ["http://gpu-box", "http://gpu-box:80"],
      ["https://ollama.example.com", "https://ollama.example.com:443"],
      ["http://10.0.0.5:11434/", "http://10.0.0.5:11434"],
      ["https://example.com:8443/ollama", "https://example.com:8443/ollama"],
      ["[::1]:11434", "http://[::1]:11434"],
      ["::1", "http://[::1]:11434"],
      ["HTTP://Box:1234", "http://Box:1234"],
    ];
    for (const [raw, want] of cases) assert.equal(ollamaUrl({ OLLAMA_HOST: raw }), want, raw);
  });

  test("anything it cannot read keeps the default rather than guessing", () => {
    for (const raw of ["ftp://box", "box:notaport", "box:70000"]) {
      assert.equal(ollamaUrl({ OLLAMA_HOST: raw }), OLLAMA_URL, raw);
    }
  });

  test("the probe goes to that address", async () => {
    let asked = "";
    globalThis.fetch = (async (url: string) => {
      asked = url;
      return { ok: true, json: async () => ({ data: [{ id: "llama3.2" }] }) };
    }) as unknown as typeof fetch;
    await probeOllama(ollamaUrl({ OLLAMA_HOST: "gpu-box:11434" }));
    assert.equal(asked, "http://gpu-box:11434/v1/models");
  });
});
