// bloks.dev's plan routes on loopback, close enough to the real ones for
// the Plan page's server side to be held to them: the offers for a plan,
// the account on a key (a bearer, 404 for a key it does not know), the
// way to billing, the hosting status a workspace asks when it is not
// online, and a pairing link to the hosted workspace, sealed for the asker
// the way the hosted workspace seals it. It can go down, the way a network
// does, to show what the app keeps meanwhile.
//
// Prices here are placeholders: the app never knows a real one, it draws
// whatever words the site sends.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { sealForRequester } from "../../server/owner-link.ts";

export const SITE_LICENCE = `blok_live_${"5".repeat(32)}`;

export interface FakeAccount {
  plan: "cloud" | "team" | "ai";
  bundle?: string | null;
  interval?: string;
  status?: string;
  renewsAt?: string | number | null;
  cancelsAt?: string | number | null;
  since?: string | number | null;
  email?: string;
  bloksAi?: { active: boolean; renewsAt?: string | null } | null;
  hosting?: { tier: string; state: string } | null;
  sharedRoom?: boolean;
  /** What the plan costs, as words; some answers leave it out. */
  price?: unknown;
}

export const OFFERS = [
  {
    id: "cloud",
    name: "Bloks Cloud",
    tagline: "Your agents on your phone, anywhere.",
    price: { amount: "P1", per: "month", yearly: { amount: "P10", per: "year", note: "Two months free" } },
    points: ["Reach this computer from anywhere", "Three workspaces online", "Notifications when an agent needs you"],
    for: ["free"],
    cta: { label: "Get Bloks Cloud", url: "SITE/cloud" },
    onSale: true,
  },
  {
    id: "team",
    name: "Bloks Team",
    tagline: "Everyone in, every workspace online.",
    price: { amount: "P2", per: "month" },
    points: ["Ten members in each workspace", "Every workspace online", "Shared rooms"],
    for: ["free", "cloud"],
    cta: { label: "Move to Team", url: "SITE/cloud/upgrade" },
    onSale: true,
  },
  {
    id: "ai",
    name: "Bloks AI",
    tagline: "Agents that run with no key of their own.",
    price: { amount: "P3", per: "month" },
    points: ["A monthly allowance", "Top up when you need more"],
    for: ["free", "cloud", "team"],
    cta: { label: "Add Bloks AI", url: "SITE/credits" },
    onSale: true,
  },
  {
    id: "hosting",
    name: "Bloks Hosting",
    tagline: "A machine that runs your workspace for you.",
    price: { amount: "P4", per: "month", note: "added to your plan" },
    points: ["Always on", "Its own browser and desktop"],
    for: ["cloud", "team"],
    cta: { label: "Add Hosting", url: "SITE/hosting" },
    onSale: false,
  },
  // a careless answer: a link that is not the site's, and one with no name
  { id: "elsewhere", name: "Elsewhere", tagline: "", points: [], for: ["cloud"], cta: { label: "Go", url: "https://example.com/buy" }, onSale: true },
  { id: "broken", for: ["cloud"] },
];

export interface FakeSite {
  base: string;
  /** Plans the offers were asked for, in order. */
  offersAsked: string[];
  /** Authorization headers the offers route saw (it is public: none). */
  offersAuth: Array<string | undefined>;
  /** Bearers the account and manage routes saw. */
  bearers: string[];
  setAccount(licence: string, account: FakeAccount | null): void;
  manageAt(kind: "portal" | "link"): void;
  /** Every request is dropped, the way a dead network drops it. */
  down(on: boolean): void;
  /** The hosted workspace is waking, for this many more link asks. */
  wakingFor(asks: number): void;
  /** The keys the hosted workspace's link was asked for with. */
  linkKeys: string[];
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

export async function startFakeSite(): Promise<FakeSite> {
  const accounts = new Map<string, FakeAccount>();
  const offersAsked: string[] = [];
  const offersAuth: Array<string | undefined> = [];
  const bearers: string[] = [];
  let manage: "portal" | "link" = "portal";
  let dead = false;
  let waking = 0;
  const linkKeys: string[] = [];
  let base = "";

  const server: Server = createServer(async (req, res) => {
    if (dead) {
      req.socket.destroy();
      return;
    }
    const body = await read(req);
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (req.method === "GET" && url.pathname === "/api/cloud/offers") {
      const plan = url.searchParams.get("plan") ?? "";
      offersAsked.push(plan);
      offersAuth.push(req.headers.authorization);
      if (!/^(free|cloud|team|ai|hosted|team-hosted)$/.test(plan)) return send(400, { error: "unknown plan" });
      const offers = OFFERS.filter((o) => (o.for ?? []).includes(plan)).map((o) => JSON.parse(JSON.stringify(o).replaceAll("SITE", base)));
      return send(200, { offers, updatedAt: "2026-10-01T00:00:00Z" });
    }
    if (req.method === "POST" && url.pathname === "/api/cloud/account") {
      bearers.push(bearer);
      if (!bearer) return send(401, { error: "no key" });
      const account = accounts.get(bearer);
      if (!account) return send(404, { error: "That is not a Bloks licence key we know." });
      return send(200, { bundle: null, interval: "month", status: "active", email: "h•••@example.com", bloksAi: null, hosting: null, sharedRoom: false, ...account });
    }
    if (req.method === "POST" && url.pathname === "/api/cloud/manage") {
      bearers.push(bearer);
      if (!accounts.get(bearer)) return send(404, { error: "unknown key" });
      return send(200, manage === "link" ? { url: "https://app.link.com/recurring", manageAt: "link" } : { url: `${base}/portal/session-1`, manageAt: "billing-portal" });
    }
    if (req.method === "POST" && url.pathname === "/api/hosting/link") {
      bearers.push(bearer);
      if (!accounts.get(bearer)) return send(404, { error: "That is not a Bloks licence key we know." });
      if (waking > 0) {
        waking -= 1;
        return send(503, { error: "Your hosted workspace is waking up. Try again in a moment.", waking: true });
      }
      const key = String(JSON.parse(body || "{}").key ?? "");
      linkKeys.push(key);
      const fragment = Buffer.from(JSON.stringify({ v: 1, k: "pair", r: "https://relay.example", t: "client-token", i: "pair_hosted1", s: "secret", host: "Sam" })).toString("base64url");
      return send(200, {
        sealed: sealForRequester(key, { link: `https://bloks.dev/pair#${fragment}`, webLink: `https://bloks.dev/web/#${fragment}`, expiresAt: Date.now() + 15 * 60_000, host: "Sam" }),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/hosting/status") {
      const account = accounts.get(bearer);
      if (!account) return send(404, { error: "That is not a Bloks licence key we know." });
      return send(200, { team: account.plan === "team" });
    }
    send(404, { error: "no such route" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    offersAsked,
    offersAuth,
    bearers,
    setAccount: (licence, account) => (account ? accounts.set(licence, account) : accounts.delete(licence)),
    manageAt: (kind) => {
      manage = kind;
    },
    down: (on) => {
      dead = on;
    },
    wakingFor: (asks) => {
      waking = asks;
    },
    linkKeys,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
