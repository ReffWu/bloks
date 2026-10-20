// The providers' list prices (server/model-prices.ts): what is kept from
// OpenRouter's model list, which listed model a turn's id is, what its
// tokens come to, whose price wins, and that the kept copy is asked for
// at most once a day and works with no network at all. Nothing here
// reaches the network: every fetch is a function the test hands in.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  PRICES_RETRY_MS,
  PRICES_TTL_MS,
  PriceBook,
  estimateCost,
  estimateTurn,
  matchModel,
  ownTokenPrice,
  parsePriceList,
  readOwnPrice,
} from "../server/model-prices.ts";

/** A row as OpenRouter's /api/v1/models sends one, cut to what matters. */
const row = (id: string, prompt: string, completion: string, extra: { slug?: string; cache?: string; created?: number } = {}) => ({
  id,
  canonical_slug: extra.slug ?? id,
  name: id,
  created: extra.created ?? 1_700_000_000,
  context_length: 128_000,
  pricing: { prompt, completion, ...(extra.cache ? { input_cache_read: extra.cache } : {}), web_search: "0.01" },
  supported_parameters: ["tools"],
});

/** A slice of the real list, in its shape: ids, dated slugs, variants,
 * routers and models at no price, as they appear there. */
const LISTED = {
  data: [
    row("openai/gpt-4o", "0.0000025", "0.00001", { cache: "0.00000125" }),
    row("openai/gpt-4o-2024-08-06", "0.0000025", "0.00001"),
    row("openai/gpt-4o:batch", "0.00000125", "0.000005", { slug: "openai/gpt-4o" }),
    row("openai/gpt-5", "0.00000125", "0.00001", { slug: "openai/gpt-5-2025-08-07", cache: "0.000000125" }),
    row("openai/o4-mini", "0.0000011", "0.0000044", { slug: "openai/o4-mini-2025-04-16" }),
    row("openai/gpt-oss-120b", "0.00000015", "0.0000006"),
    row("anthropic/claude-sonnet-4.5", "0.000003", "0.000015", { slug: "anthropic/claude-4.5-sonnet-20250929", cache: "0.0000003" }),
    row("anthropic/claude-opus-4.1", "0.000015", "0.000075", { slug: "anthropic/claude-4.1-opus-20250805" }),
    row("anthropic/claude-sonnet-4", "0.000003", "0.000015", { slug: "anthropic/claude-4-sonnet-20250522" }),
    row("anthropic/claude-3.5-haiku", "0.0000008", "0.000004"),
    row("google/gemini-2.5-pro", "0.00000125", "0.00001", { cache: "0.000000125" }),
    row("google/gemini-2.5-flash", "0.0000003", "0.0000025"),
    row("google/gemini-3.1-pro-preview", "0.000002", "0.000012", { slug: "google/gemini-3.1-pro-preview-20260219" }),
    row("google/gemma-4-31b-it:free", "0", "0", { slug: "google/gemma-4-31b-it-20260402" }),
    row("google/lyria-3-pro-preview", "0", "0"),
    row("~google/gemini-flash-latest", "0.00000075", "0.00000375"),
    row("x-ai/grok-4", "0.000003", "0.000015"),
    row("x-ai/grok-4.7", "0.000002", "0.000006", { slug: "x-ai/grok-4.7-20260916" }),
    row("x-ai/grok-4.20", "0.00000125", "0.0000025", { slug: "x-ai/grok-4.20-20260309" }),
    row("deepseek/deepseek-chat", "0.0000002574", "0.0000010287", { slug: "deepseek/deepseek-chat-v3" }),
    row("mistralai/mistral-large", "0.000002", "0.000006", { created: 1_700_000_000 }),
    row("mistralai/mistral-large-2512", "0.0000005", "0.0000015", { created: 1_765_000_000 }),
    row("mistralai/mistral-large-4-0", "0.00000068", "0.00000209", { created: 1_791_000_000 }),
    row("mistralai/mistral-large-instruct", "0.000009", "0.000009", { created: 1_799_000_000 }),
    row("mistralai/mistral-medium-3-5", "0.0000015", "0.0000075", { slug: "mistralai/mistral-medium-3.5-20260430" }),
    row("mistralai/codestral-2508", "0.0000003", "0.0000009", { created: 1_754_000_000 }),
    row("meta-llama/llama-4-maverick", "0.0000001875", "0.0000006525", { slug: "meta-llama/llama-4-maverick-17b-128e-instruct" }),
    row("meta-llama/llama-3.3-70b-instruct", "0.0000001", "0.00000032"),
    row("meta-llama/llama-3.1-8b-instruct", "0.00000005", "0.00000008"),
    row("qwen/qwen3-32b", "0.00000008", "0.00000028", { slug: "qwen/qwen3-32b-04-28" }),
    row("qwen/qwen-plus", "0.00000026", "0.00000078", { slug: "qwen/qwen-plus-2025-01-25" }),
    row("moonshotai/kimi-k2", "0.00000057", "0.0000023"),
    row("moonshotai/kimi-k2-0905", "0.0000006", "0.0000025"),
    row("nvidia/nemotron-nano-9b-v2", "0.00000004", "0.00000016"),
    row("openrouter/auto", "-1", "-1"),
    { id: "broken/one", pricing: { prompt: "free", completion: "0.1" } },
    { id: 42 },
    null,
  ],
};

const LIST = parsePriceList(LISTED, 1_000)!;

test("the list keeps every model with a price, and leaves out variants, routers and the unpriced", () => {
  assert.ok(LIST);
  assert.equal(LIST.fetchedAt, 1_000);
  assert.deepEqual(LIST.prices["anthropic/claude-sonnet-4.5"], { input: 0.000003, output: 0.000015, cachedInput: 0.0000003, created: 1_700_000_000 });
  assert.equal(LIST.prices["openai/gpt-4o:batch"], undefined, "a batch price is OpenRouter's deal, not the lab's");
  assert.equal(LIST.prices["google/gemma-4-31b-it:free"], undefined, "a free variant is no list price");
  assert.equal(LIST.prices["google/lyria-3-pro-preview"], undefined, "nothing at all is no price, not free");
  assert.equal(LIST.prices["openrouter/auto"], undefined, "a router's -1 is no rate");
  assert.equal(LIST.prices["broken/one"], undefined);
  // a lab's dated id points at the model it dates
  assert.equal(LIST.aliases["openai/gpt-5-2025-08-07"], "openai/gpt-5");
  assert.equal(LIST.aliases["anthropic/claude-4.5-sonnet-20250929"], "anthropic/claude-sonnet-4.5");
  assert.equal(LIST.aliases["openai/gpt-4o"], undefined, "an id is never its own alias");
  assert.equal(LIST.aliases["google/gemma-4-31b-it-20260402"], undefined, "a variant's slug leads nowhere");
  for (const bad of [null, {}, { data: "no" }, []]) assert.equal(parsePriceList(bad, 0), null);
});

test("a turn's model is matched to the list as each provider names it", () => {
  const cases: Array<[engine: string, model: string, expected: string | null]> = [
    // Gemini, as Google's OpenAI-compatible API names its models
    ["gemini", "gemini-2.5-pro", "google/gemini-2.5-pro"],
    ["gemini", "models/gemini-2.5-flash", "google/gemini-2.5-flash"],
    ["gemini", "gemini-3.1-pro-preview", "google/gemini-3.1-pro-preview"],
    ["gemini", "gemini-flash-latest", "~google/gemini-flash-latest"],
    // xAI, dated and with thinking on or off
    ["grok", "grok-4.7", "x-ai/grok-4.7"],
    ["grok", "grok-4-0709", "x-ai/grok-4"],
    ["grok", "grok-4.20-0309-non-reasoning", "x-ai/grok-4.20"],
    ["grok", "grok-4.20-0309-reasoning", "x-ai/grok-4.20"],
    // DeepSeek, Mistral, Moonshot and Meta on their own APIs
    ["deepseek", "deepseek-chat", "deepseek/deepseek-chat"],
    ["mistral", "mistral-large-latest", "mistralai/mistral-large-4-0"],
    ["mistral", "codestral-latest", "mistralai/codestral-2508"],
    ["mistral", "mistral-medium-3-5", "mistralai/mistral-medium-3-5"],
    ["kimi", "kimi-k2-0905-preview", "moonshotai/kimi-k2-0905"],
    ["llama", "Llama-4-Maverick-17B-128E-Instruct-FP8", "meta-llama/llama-4-maverick"],
    // OpenAI and Anthropic behind a custom host, dated and undated
    ["custom", "gpt-4o", "openai/gpt-4o"],
    ["custom", "GPT-4o", "openai/gpt-4o"],
    ["custom", "gpt-4o-2024-08-06", "openai/gpt-4o-2024-08-06"],
    ["custom", "gpt-5-2025-08-07", "openai/gpt-5"],
    ["custom", "o4-mini", "openai/o4-mini"],
    ["custom", "claude-sonnet-4-5-20250929", "anthropic/claude-sonnet-4.5"],
    ["custom", "claude-sonnet-4-5", "anthropic/claude-sonnet-4.5"],
    ["custom", "claude-opus-4-1", "anthropic/claude-opus-4.1"],
    ["custom", "claude-sonnet-4-20250514", "anthropic/claude-sonnet-4"],
    ["custom", "claude-3-5-haiku-20241022", "anthropic/claude-3.5-haiku"],
    ["custom", "qwen-plus", "qwen/qwen-plus"],
    // hosts that put the lab in front, in their own case
    ["custom", "meta-llama/Llama-3.3-70B-Instruct", "meta-llama/llama-3.3-70b-instruct"],
    ["custom", "deepseek-ai/deepseek-chat", "deepseek/deepseek-chat"],
    ["groq", "openai/gpt-oss-120b", "openai/gpt-oss-120b"],
    ["groq", "qwen/qwen3-32b", "qwen/qwen3-32b"],
    ["groq", "moonshotai/kimi-k2-instruct", "moonshotai/kimi-k2"],
    ["groq", "llama-3.3-70b-versatile", "meta-llama/llama-3.3-70b-instruct"],
    ["groq", "llama-3.1-8b-instant", "meta-llama/llama-3.1-8b-instruct"],
    // OpenRouter's own ids, for a turn it did not price
    ["openrouter", "anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-4.5"],
    ["openrouter", "nvidia/nemotron-nano-9b-v2", "nvidia/nemotron-nano-9b-v2"],
  ];
  for (const [engine, model, expected] of cases) {
    assert.equal(matchModel(LIST, engine, model), expected, `${engine} ${model}`);
  }
});

test("a model the list does not name is never matched to a neighbour", () => {
  const unknown: Array<[string, string]> = [
    ["custom", ""],
    ["custom", "   "],
    ["custom", "my-finetune-v2"],
    ["custom", "gpt-4o-mini-tts"],
    ["custom", "claude-sonnet-9"],
    ["deepseek", "deepseek-reasoner"],
    // Kimi's turbo is its own price, not K2's
    ["kimi", "kimi-k2-turbo-preview"],
    ["kimi", "moonshot-v1-32k"],
    // an experiment is not the release it came before
    ["gemini", "gemini-2.5-pro-exp-03-25"],
    // a free or batch variant is not the paid model
    ["openrouter", "google/gemma-4-31b-it:free"],
    ["openrouter", "openai/gpt-4o:batch"],
    ["openrouter", "openrouter/auto"],
    // a lab this list is not asked about, by a name it does not have
    ["custom", "nvidia/some-other-model"],
    ["ollama", "llama3.2"],
    // a bare name on a host that serves anybody's models says nothing
    ["custom", "large-v3"],
    ["groq", "whisper-large-v3"],
  ];
  for (const [engine, model] of unknown) assert.equal(matchModel(LIST, engine, model), null, `${engine} ${model}`);
  // "-latest" never falls back to a name that only starts the same way
  assert.notEqual(matchModel(LIST, "mistral", "mistral-large-latest"), "mistralai/mistral-large-instruct");
});

test("an estimate is input at the input rate, cached input at the cache's, and output at the output rate", () => {
  const price = { input: 0.000003, output: 0.000015, cachedInput: 0.0000003 };
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} is not ${b}`);
  close(estimateCost(price, { input: 10_000, output: 2_000 }), 0.03 + 0.03);
  // 6,000 fresh, 4,000 from the cache, 2,000 out
  close(estimateCost(price, { input: 10_000, output: 2_000, cachedInput: 4_000 }), 0.018 + 0.0012 + 0.03);
  // no cache rate is the full rate, which can only overstate
  close(estimateCost({ input: 0.000003, output: 0.000015 }, { input: 10_000, output: 0, cachedInput: 4_000 }), 0.03);
  // more cached than sent is all of it cached, never a negative
  close(estimateCost(price, { input: 1_000, output: 0, cachedInput: 5_000 }), 0.0003);
  close(estimateCost(price, { input: -5, output: Number.NaN }), 0);
  // a million tokens at $3 and $15 a million is $18
  close(estimateCost(ownTokenPrice({ input: 3, output: 15 }), { input: 1_000_000, output: 1_000_000 }), 18);
});

test("the person's own price comes ahead of the list, and neither is no estimate", () => {
  const used = { model: "gemini-2.5-pro", input: 1_000_000, output: 100_000, cachedInput: 0 };
  const listed = estimateTurn(used, "gemini", null, LIST)!;
  assert.deepEqual([listed.source, listed.id], ["list", "google/gemini-2.5-pro"]);
  assert.ok(Math.abs(listed.cost - (1.25 + 1)) < 1e-9);
  const own = estimateTurn(used, "gemini", { input: 2, output: 10 }, LIST)!;
  assert.equal(own.source, "own");
  assert.ok(Math.abs(own.cost - (2 + 1)) < 1e-9, "own price wins even where the list has the model");
  // a custom host's own model, priced only by the person
  const custom = { model: "house-model-7b", input: 500_000, output: 500_000, cachedInput: 0 };
  assert.equal(estimateTurn(custom, "custom", null, LIST), null);
  assert.ok(Math.abs(estimateTurn(custom, "custom", { input: 1, output: 1 }, null)!.cost - 1) < 1e-9, "no list needed for an own price");
  assert.equal(estimateTurn(used, "gemini", null, null), null, "no list, no own price: no estimate");
  assert.equal(estimateTurn({ ...used, input: 0, output: 0 }, "gemini", { input: 2, output: 10 }, LIST), null, "no tokens is no estimate, not free");
});

test("an own price is dollars per million for both, and nothing else", () => {
  assert.deepEqual(readOwnPrice({ input: 3, output: 15 }), { input: 3, output: 15 });
  assert.deepEqual(readOwnPrice({ input: "$0.15", output: " 0.6 " }), { input: 0.15, output: 0.6 });
  assert.deepEqual(readOwnPrice({ input: 0, output: 2 }), { input: 0, output: 2 }, "free input with a priced output is a price");
  assert.equal(readOwnPrice(null), null, "null takes it off");
  for (const bad of [undefined, {}, { input: 3 }, { input: "", output: "" }, { input: "3", output: "" }, { input: 0, output: 0 }, { input: -1, output: 2 }, { input: "ten", output: 2 }, { input: 1, output: 20_000 }, "3/15", 3]) {
    assert.equal(readOwnPrice(bad), undefined, JSON.stringify(bad));
  }
});

// ── the copy in the data folder ────────────────────────────────────────

function book(options: { list?: () => unknown; fail?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-prices-"));
  const file = join(dir, "model-prices.json");
  let now = 10_000_000;
  const asked: string[] = [];
  const prices = new PriceBook({
    file,
    url: "fixture://models",
    now: () => now,
    fetchList: async (url) => {
      asked.push(url);
      if (options.fail) throw new Error("offline");
      return (options.list ?? (() => LISTED))();
    },
  });
  return { prices, file, asked, advance: (ms: number) => (now += ms), at: () => now };
}

test("the list is fetched once, kept with its time, and not asked for again within the day", async () => {
  const b = book();
  assert.equal(b.prices.current(), null, "nothing kept yet");
  assert.equal(await b.prices.refresh(), true);
  assert.deepEqual(b.asked, ["fixture://models"]);
  const kept = JSON.parse(readFileSync(b.file, "utf8"));
  assert.equal(kept.fetchedAt, b.at());
  assert.ok(kept.prices["google/gemini-2.5-pro"]);
  // asked again and again inside the day: the copy answers
  b.advance(PRICES_TTL_MS - 1);
  await Promise.all([b.prices.refresh(), b.prices.refresh()]);
  assert.equal(b.asked.length, 1);
  // a day on, once more
  b.advance(1);
  assert.equal(b.prices.fresh(), false);
  await b.prices.refresh();
  assert.equal(b.asked.length, 2);
});

test("two asks at once are one fetch", async () => {
  const b = book();
  const [one, two] = await Promise.all([b.prices.refresh(), b.prices.refresh()]);
  assert.deepEqual([one, two, b.asked.length], [true, true, 1]);
});

test("offline, a kept list still prices turns, and a failed fetch waits an hour to try again", async () => {
  const first = book();
  await first.prices.refresh();
  // a new run, a day later, with no network: the kept copy is used
  const offline = new PriceBook({ file: first.file, now: () => first.at() + 2 * PRICES_TTL_MS, fetchList: async () => { throw new Error("offline"); } });
  assert.equal(await offline.refresh(), false);
  const estimate = offline.estimate({ model: "gpt-4o", input: 1_000, output: 0 }, "custom");
  assert.equal(estimate?.id, "openai/gpt-4o", "a stale list still beats no list");

  const nothing = book({ fail: true });
  assert.equal(await nothing.prices.refresh(), false);
  assert.equal(nothing.prices.estimate({ model: "gpt-4o", input: 1_000, output: 0 }, "custom"), null, "no list, no estimate");
  assert.equal(existsSync(nothing.file), false, "a failed fetch writes nothing");
  await nothing.prices.refresh();
  assert.equal(nothing.asked.length, 1, "not asked again straight after failing");
  nothing.advance(PRICES_RETRY_MS);
  await nothing.prices.refresh();
  assert.equal(nothing.asked.length, 2, "asked again an hour on");
});

test("an empty or broken answer leaves the kept list alone, and a broken copy is no list", async () => {
  let answer: unknown = LISTED;
  const b = book({ list: () => answer });
  await b.prices.refresh();
  b.advance(PRICES_TTL_MS);
  answer = { data: [] };
  assert.equal(await b.prices.refresh(), false);
  assert.ok(b.prices.current()?.prices["openai/gpt-4o"], "an empty list wiped a good one");
  assert.ok(JSON.parse(readFileSync(b.file, "utf8")).prices["openai/gpt-4o"]);

  const broken = book();
  writeFileSync(broken.file, "{not json");
  assert.equal(broken.prices.current(), null);
  assert.equal(await broken.prices.refresh(), true, "a broken copy is replaced by the next fetch");
});

test("a fetch time ahead of the clock is not trusted to be fresh", async () => {
  const b = book();
  await b.prices.refresh();
  b.advance(-60_000);
  assert.equal(b.prices.fresh(), false);
});
