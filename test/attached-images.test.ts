// Pictures attached to a message reach an engine that can see them
// (GitHub 365): as image parts to an OpenAI-compatible host the person
// says sees them, such as a llama.cpp server with its vision projector,
// and as image blocks to an ACP agent (OpenCode) that says it takes them.
// A host nobody said sees them is sent only the path, and the chat says so.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

// The ACP driver writes its native copy under the data folder, which is
// read the first time anything imports server/config.ts. A folder of this
// test's own, set before every import of the server below, never ~/.bloks.
const data = mkdtempSync(join(tmpdir(), "bloks-images-data-"));
process.env.BLOKS_DATA_DIR = data;
const { startHarness } = await import("./helpers/server.ts");
const { idle, messagesOf, waitFor } = await import("./helpers/turns.ts");
const { ACP_SPECS, acpDriver, pictureBlocks } = await import("../server/drivers/acp.ts");
const { widenPath } = await import("../server/path.ts");
process.on("exit", () => rmSync(data, { recursive: true, force: true }));

/** The smallest thing the server takes as a PNG: its signature, then bytes. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really pixels")]);

/** A llama.cpp server as the driver sees it: one model, and a streamed
 * reply to each chat call, whose body is kept. */
async function llamaServer(t: { after: (fn: () => unknown) => void }, blind = false) {
  const calls: any[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ data: [{ id: "qwen3.5-4b" }] }));
      }
      calls.push(JSON.parse(body));
      // what llama.cpp says when its model was started without a projector
      if (blind && body.includes('"image_url"')) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ error: { code: 500, message: "image input is not supported - hint: if this is unexpected, you may need to provide the mmproj", type: "server_error" } }));
      }
      res.setHeader("content-type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "A goblin in armour." } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { calls, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
}

test("a custom endpoint is sent attached images as pictures once the person says its model sees them", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const llama = await llamaServer(t);
  const { endpoints } = await h.json("/api/custom-endpoints", {
    method: "POST",
    body: JSON.stringify({ name: "Local (llama.cpp)", url: llama.url, key: "none" }),
  });
  const endpoint = endpoints[0];
  assert.equal(endpoint.vision, false, "a new endpoint is not taken to see");
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Looker" }) });
  await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: endpoint.instanceId, model: "qwen3.5-4b" } }) });

  const saved = await h.json("/api/attachments", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(PNG) });
  assert.match(saved.path, /[0-9a-f-]{36}\.png$/);
  const name = saved.path.split(/[\\/]/).at(-1);
  const ask = async (words: string) => {
    const before = llama.calls.length;
    const res = await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: words }) });
    assert.ok(res.ok, await res.text());
    assert.ok(await waitFor(() => llama.calls.length > before), h.logs());
    assert.ok(await idle(h, bot));
    return llama.calls.at(-1).messages.at(-1);
  };
  const notices = async () => (await messagesOf(h, bot)).filter((m) => m.kind === "notice" && /see images/.test(m.text ?? ""));

  // Not said to see: the words go as they are, and the chat says why
  // the picture did not.
  const words = `What is in this picture?\n\n<attached-image path="${saved.path}" />`;
  const blind = await ask(words);
  assert.equal(typeof blind.content, "string");
  assert.ok(blind.content.includes(words));
  const said = await notices();
  assert.equal(said.length, 1);
  assert.equal(
    said[0].text,
    "Local (llama.cpp) is not set to see images, so the image was not sent to it. If its model can see them, turn on Sees images for it under Your endpoints in Settings.",
  );

  // Said to see: the picture goes inline, as llama.cpp takes it. A path
  // written on Windows names the same file, and a path to anything Bloks
  // did not keep itself is never read.
  const turned = await h.json(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ vision: true }) });
  assert.equal(turned.endpoints[0].vision, true);
  assert.ok(readFileSync(join(h.home, ".bloks", "config.json"), "utf8").includes('"vision": true'), "the switch is not kept");
  const windows = `C:\\Users\\Someone\\.bloks\\attachments\\${name}`;
  const seeing = await ask(
    `And now?\n\n<attached-image path="${windows}" />\n\n<attached-image path="/etc/hosts" />\n\n<attached-image path="file:///C:/Users/Someone/.bloks/attachments/${name}" />`,
  );
  assert.ok(Array.isArray(seeing.content), "the picture was not sent as a picture");
  assert.equal(seeing.content[0].type, "text");
  assert.ok(seeing.content[0].text.includes("And now?"));
  assert.deepEqual(seeing.content.slice(1), [
    { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } },
  ]);
  assert.equal((await notices()).length, 1, "a host that sees was told it does not");
  // the reply came back as any reply does
  assert.ok((await messagesOf(h, bot)).some((m) => m.role === "bot" && m.text === "A goblin in armour."));

  // and the native copy keeps the picture's size, not its bytes
  const native = readFileSync(join(h.home, ".bloks", "native", `${bot.threadId}.ndjson`), "utf8");
  assert.ok(!native.includes(PNG.toString("base64")), "the picture was written whole into the native copy");
  assert.match(native, /data:image\/png;base64,\(\d+ characters\)/);

  // Switched off again, the next one goes by its path only.
  await h.json(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ vision: false }) });
  assert.equal(typeof (await ask(words)).content, "string");
  assert.equal((await h.fetch(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ vision: "yes" }) })).status, 400);
});

test("a host switched on whose model cannot see says so plainly", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const llama = await llamaServer(t, true);
  const { endpoints } = await h.json("/api/custom-endpoints", {
    method: "POST",
    body: JSON.stringify({ name: "Local (llama.cpp)", url: llama.url, key: "none" }),
  });
  await h.json(`/api/custom-endpoints/${endpoints[0].id}`, { method: "PATCH", body: JSON.stringify({ vision: true }) });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Looker" }) });
  await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: endpoints[0].instanceId, model: "qwen3.5-4b" } }) });
  const saved = await h.json("/api/attachments", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(PNG) });
  const res = await h.fetch(`/api/bots/${bot.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: `What is this?\n\n<attached-image path="${saved.path}" />` }),
  });
  assert.ok(res.ok, await res.text());
  const said = await waitFor(async () =>
    (await messagesOf(h, bot)).find((m) => m.kind === "notice" && /could not take the image/.test(m.text ?? "")),
  );
  assert.ok(said, h.logs());
  assert.match(said.text, /Local \(llama\.cpp\) could not take the image, because its model does not see images\. Load one that does \(llama\.cpp needs its --mmproj file\), or turn off Sees images for it in Settings\./);
  assert.doesNotMatch(said.text, /HTTP 500/);
});

/** A fake OpenCode on PATH that logs every request it is sent, and says
 * in initialize whether it takes pictures, as OpenCode itself does. */
async function withOpenCode(images: boolean, fn: (received: () => any[]) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "bloks-images-acp-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(home, "received.ndjson");
  const script = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const log = ${JSON.stringify(log)};`,
    `const capabilities = ${JSON.stringify(images ? { promptCapabilities: { embeddedContext: true, image: true } } : {})};`,
    "const say = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');",
    "require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {",
    "  let msg; try { msg = JSON.parse(line); } catch { return; }",
    "  if (msg.id === undefined || !msg.method) return;",
    "  fs.appendFileSync(log, JSON.stringify({ method: msg.method, params: msg.params }) + '\\n');",
    "  const reply = (result) => say({ jsonrpc: '2.0', id: msg.id, result });",
    "  if (msg.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: capabilities });",
    "  else if (msg.method === 'session/new') reply({ sessionId: 's1' });",
    "  else if (msg.method === 'session/prompt') {",
    "    say({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1',",
    "      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'A goblin.' } } } });",
    "    reply({ stopReason: 'end_turn' });",
    "  } else reply({});",
    "});",
  ].join("\n");
  writeFileSync(join(bin, "opencode"), script + "\n", { mode: 0o755 });
  const prev = { HOME: process.env.HOME, PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // the fake first, so no OpenCode installed on this machine is ever run
  process.env.PATH = bin + delimiter + dirname(process.execPath);
  widenPath();
  try {
    await fn(() => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []));
  } finally {
    process.env.HOME = prev.HOME;
    process.env.USERPROFILE = prev.USERPROFILE;
    process.env.PATH = prev.PATH;
    rmSync(home, { recursive: true, force: true });
  }
}

async function openCodeTurn(images: Array<{ mime: string; data: string }>) {
  const spec = ACP_SPECS.find((s) => s.kind === "opencode")!;
  const inst = await acpDriver(spec).create({
    instanceId: "opencode",
    displayName: "OpenCode",
    enabled: true,
    config: { cli: "opencode", fullAuto: false },
    environment: {},
  });
  await inst.catalogReady;
  assert.equal(inst.adapter.capabilities.images, true);
  const events: any[] = [];
  inst.adapter.onEvent((e) => events.push(e));
  await inst.adapter.sendTurn({ threadId: "t1", text: `What is this?\n\n<attached-image path="C:\\pics\\x.png" />`, images });
  for (let i = 0; i < 50 && !events.some((e) => e.type === "turn.completed"); i++) await new Promise((r) => setTimeout(r, 100));
  await inst.dispose();
  return events;
}

test("OpenCode, which says it takes pictures, is sent the turn's pictures as image blocks", async () => {
  const picture = { mime: "image/png", data: PNG.toString("base64") };
  await withOpenCode(true, async (received) => {
    const events = await openCodeTurn([picture]);
    assert.ok(events.some((e) => e.type === "turn.completed" && e.ok !== false));
    const prompt = received().find((m) => m.method === "session/prompt")?.params.prompt;
    assert.equal(prompt?.[0]?.type, "text");
    assert.ok(prompt[0].text.includes("What is this?"));
    assert.deepEqual(prompt.slice(1), [{ type: "image", mimeType: "image/png", data: picture.data }]);
    assert.deepEqual(pictureBlocks(undefined), []);
  });
});

test("an ACP agent that does not say it takes pictures gets the words alone", async () => {
  await withOpenCode(false, async (received) => {
    await openCodeTurn([{ mime: "image/png", data: PNG.toString("base64") }]);
    const prompt = received().find((m) => m.method === "session/prompt")?.params.prompt;
    assert.equal(prompt?.length, 1);
    assert.equal(prompt[0].type, "text");
  });
});
