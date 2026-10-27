// Home Assistant's rules without Home Assistant: what an agent may see,
// what a change may aim at, what asks, and what an agent reads back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowed,
  alwaysAsks,
  automationYaml,
  cleanBaseUrl,
  cleanLists,
  cleanToken,
  commandName,
  describeCall,
  entityView,
  goesWithoutAsking,
  historyView,
  planCall,
  type HomeSettings,
  type HomeState,
} from "../server/home-assistant.ts";

const settings: HomeSettings = { url: "http://ha.test:8123", token: "t", enabled: true, entities: ["light.kitchen", "lock.front_door", "cover.garage"], domains: ["sensor"], auto: ["light.kitchen", "cover.garage"], agents: ["bot1"] };
const state = (entity_id: string, attributes: Record<string, unknown> = {}, value = "on"): HomeState => ({ entity_id, state: value, attributes });

test("nothing is visible unless it is listed, by entity or by its whole domain", () => {
  assert.equal(allowed(settings, "light.kitchen"), true);
  assert.equal(allowed(settings, "sensor.anything"), true);
  assert.equal(allowed(settings, "light.porch"), false);
  assert.equal(allowed({}, "light.kitchen"), false, "an empty list is nothing, not everything");
});

test("a call names entities on the list, in their own domain or the generic switches", () => {
  const ok = planCall(settings, { service: "light.turn_on", entities: ["light.kitchen"], data: { brightness_pct: 40 } });
  assert.deepEqual(ok, { domain: "light", service: "turn_on", entities: ["light.kitchen"], data: { brightness_pct: 40 } });
  assert.ok("error" in planCall(settings, { service: "light.turn_on", entities: ["light.porch"] }), "off the list");
  assert.ok("error" in planCall(settings, { service: "light.turn_on", entities: ["lock.front_door"] }), "another domain's service");
  assert.ok(!("error" in planCall(settings, { service: "homeassistant.turn_off", entities: ["light.kitchen"] })));
  assert.ok("error" in planCall(settings, { service: "homeassistant.restart", entities: ["light.kitchen"] }), "nothing that reaches past the entity");
  assert.ok("error" in planCall(settings, { service: "light.turn_on", entities: [] }), "a call aims at something");
  assert.ok("error" in planCall(settings, { service: "rm -rf", entities: ["light.kitchen"] }));
  assert.ok("error" in planCall(settings, { service: "light.turn_on", entities: Array.from({ length: 11 }, () => "light.kitchen").map((id, i) => `${id}${i}`) }));
});

test("data cannot widen a call past its entities", () => {
  const plan = planCall(settings, { service: "light.turn_on", entities: ["light.kitchen"], data: { entity_id: "all", area_id: "house", device_id: "x", floor_id: "y", label_id: "z", brightness: 9 } });
  assert.ok(!("error" in plan));
  assert.deepEqual((plan as { data: unknown }).data, { brightness: 9 });
  assert.ok("error" in planCall(settings, { service: "light.turn_on", entities: ["light.kitchen"], data: [1, 2] }));
});

test("locks, alarms and garage doors always ask, whatever was marked", () => {
  assert.equal(alwaysAsks("lock.front_door"), true);
  assert.equal(alwaysAsks("alarm_control_panel.home"), true);
  assert.equal(alwaysAsks("cover.big_door", { attributes: { device_class: "garage" } }), true);
  assert.equal(alwaysAsks("cover.side", { attributes: { device_class: "gate" } }), true);
  assert.equal(alwaysAsks("cover.door_2", { attributes: { friendly_name: "Garage" } }), true, "a door its integration left unclassed is still a door");
  assert.equal(alwaysAsks("cover.blinds", { attributes: { device_class: "blind" } }), false);
  assert.equal(alwaysAsks("light.kitchen"), false);
  const plan = (entities: string[]) => planCall(settings, { service: entities[0]!.startsWith("cover") ? "cover.open_cover" : "light.turn_on", entities }) as never;
  assert.equal(goesWithoutAsking(settings, plan(["light.kitchen"]), new Map()), true);
  assert.equal(goesWithoutAsking(settings, plan(["cover.garage"]), new Map([["cover.garage", state("cover.garage", { device_class: "garage" })]])), false);
});

test("the owner's lists are cleaned, and nothing that always asks is ever auto", () => {
  const lists = cleanLists({ entities: ["light.kitchen", "lock.door", "light.kitchen", "nonsense", 7], domains: ["sensor", "Not A Domain"], auto: ["lock.door", "light.kitchen", "light.porch"] }, {});
  assert.deepEqual(lists, { entities: ["light.kitchen", "lock.door"], domains: ["sensor"], auto: ["light.kitchen"] });
  assert.deepEqual(cleanLists({}, settings).entities, settings.entities, "a list not sent is the one kept");
});

test("what an agent reads is bounded and cleaned: no reordering marks, no pictures, no deep nesting", () => {
  const view = entityView(state("sensor.t", {
    friendly_name: "Living room\u202e\u200b temperature",
    entity_picture: "/api/camera_proxy/x?token=secret",
    access_token: "secret",
    note: "x".repeat(500),
    deep: { a: { b: { c: 1 } } },
  }, "21.5"), settings, "Lounge");
  assert.equal(view.name, "Living room   temperature");
  assert.equal(view.area, "Lounge");
  assert.equal((view.attributes as Record<string, unknown>).entity_picture, undefined);
  assert.equal((view.attributes as Record<string, unknown>).access_token, undefined);
  assert.equal(((view.attributes as Record<string, unknown>).note as string).length, 200);
  assert.deepEqual((view.attributes as Record<string, unknown>).deep, { a: {} });
  assert.equal(view.changes, "asks the owner");
});

test("history keeps the newest points and reads either answer shape", () => {
  const points = historyView([[{ state: "1", last_changed: "a" }, { s: "2", lu: 1700000000 }, { junk: true }]]);
  assert.deepEqual(points, [{ state: "1", at: "a" }, { state: "2", at: new Date(1700000000000).toISOString() }]);
  assert.equal(historyView([Array.from({ length: 500 }, (_, i) => ({ state: String(i), last_changed: "t" }))], 200).at(0)!.state, "300");
  assert.deepEqual(historyView(null), []);
});

test("a card says what will happen in the names the owner knows", () => {
  const plan = planCall(settings, { service: "light.turn_on", entities: ["light.kitchen"], data: { brightness_pct: 40 } }) as never;
  assert.equal(describeCall(plan, new Map([["light.kitchen", state("light.kitchen", { friendly_name: "Kitchen light" })]])), 'light.turn_on on Kitchen light (light.kitchen) with {"brightness_pct":40}');
});

test("the address and the token are checked for shape before any round trip", () => {
  assert.equal(cleanBaseUrl("http://homeassistant.local:8123/"), "http://homeassistant.local:8123");
  assert.equal(cleanBaseUrl("https://home.example.com/ha/"), "https://home.example.com/ha");
  assert.equal(cleanBaseUrl("http://user:pass@ha.local"), null, "a credential in the address would be sent everywhere");
  assert.equal(cleanBaseUrl("ftp://ha.local"), null);
  assert.equal(cleanBaseUrl("http://ha.local/?x=1"), null);
  assert.equal(cleanToken("aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc"), "aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc");
  assert.equal(cleanToken("hunter2"), null);
});

test("the YAML posts to the agent's webhook, watches what was named, and listens for its name by voice", () => {
  const yaml = automationYaml("Nova Café", "http://192.168.1.20:8799/hook/abc", "binary_sensor.front_door");
  assert.equal(commandName("Nova Café"), "bloks_nova_cafe");
  assert.match(yaml.command, /rest_command:\n {2}bloks_nova_cafe:\n {4}url: "http:\/\/192\.168\.1\.20:8799\/hook\/abc"/);
  assert.match(yaml.command, /to_json/);
  assert.match(yaml.state, /entity_id: binary_sensor\.front_door/);
  assert.match(yaml.state, /action: rest_command\.bloks_nova_cafe/);
  assert.match(yaml.voice, /- "ask nova cafe \{request\}"/);
  // an entity that is not one is not written into YAML
  assert.doesNotMatch(automationYaml("Nova", "http://x/hook/a", "x\ny: z").state, /\ny: z/);
  assert.ok(!/[\u2013\u2014]/.test(Object.values(yaml).join("")));
});
