// The plan on this computer's one licence, kept by the app for every
// workspace. Plain Node, so it can be tested outside Electron
// (test/account-plan.test.ts).
//
// A plan is the person's, like the licence it comes with: upgrading in
// one workspace is upgrading in all of them. Each workspace's server asks
// bloks.dev or the relay for it, but a workspace made a minute ago has
// asked nobody yet, and used to say so to the app as "no plan", which
// locked Team everywhere until some other server spoke again. So the app
// keeps the last real answer itself, on disk beside the licence and
// under the licence's fingerprint (never the key), hands it to each
// server as it starts, and takes a server's word only when that server
// is speaking about the app's own licence.

import fs from "node:fs";
import path from "node:path";

const PLANS = new Set(["team", "cloud"]);

/** "team", "cloud", or null; anything else is not a plan. */
export function cleanPlan(plan) {
  return PLANS.has(plan) ? plan : null;
}

/**
 * The plan kept for this licence, or undefined when nothing is kept for
 * it: no file, a broken one, or one kept for another licence. `print` is
 * the licence's fingerprint (electron/plan-link.mjs licencePrint), or
 * null when there is no licence.
 */
export function readKeptPlan(file, print) {
  if (!print) return undefined;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved?.print !== print) return undefined;
    return saved.plan === null ? null : PLANS.has(saved.plan) ? saved.plan : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the plan for this licence, or forgets it with no licence. */
export function keepPlan(file, print, plan, now = Date.now()) {
  try {
    if (!print) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const staging = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(staging, JSON.stringify({ plan: cleanPlan(plan), print, at: now }), { mode: 0o600 });
    fs.renameSync(staging, file);
  } catch {
    /* kept in memory for this run; the next answer tries the disk again */
  }
}

/**
 * What a server's report of the plan means for the app's own, or
 * undefined when it means nothing.
 *
 * `report` is the "desktop.plan" message: the plan, and `shared`, which
 * is whether the server was speaking about the licence the app handed it
 * (a workspace that kept a different key of its own speaks only for
 * itself). A server from before `shared` existed sends none, and is
 * taken at its word. "No plan" is only believed while the app has no
 * licence either: a server with no licence cannot speak for the app's.
 */
export function planFromReport(report, { hasLicence }) {
  if (!report || report.shared === false) return undefined;
  const plan = cleanPlan(report.plan);
  if (plan === null && hasLicence) return undefined;
  return plan;
}
