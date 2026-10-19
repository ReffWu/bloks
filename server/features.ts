// What this server can do for a client on another device, by name.
//
// The phone comes from the App Store and this app updates itself, each on
// its own schedule, so either one can be ahead of the other. /api/health
// carries this list and the version beside it; a phone reads them and
// hides what this Mac cannot do yet, instead of offering a button whose
// answer is a 404 it has to explain.
//
// Names rather than version numbers, because a name means one thing
// however releases are numbered. The rules that keep it honest:
//
//   Add a name in the same change that adds what it names, for anything a
//   phone or another computer calls: a route, a field a route now reads,
//   an event the stream now sends.
//
//   Never take a name out while a phone build that asks for it could still
//   be in use. Removing what it names is a separate, later decision.
export const FEATURES: readonly string[] = [
  // PATCH section on agents and rooms, and the sidebar sections it files into
  "sections",
  // ?before= paging on a transcript, for loading earlier messages
  "earlier",
  // GET /api/bots/:id/exchange/:peer, one agent's messages with another
  "exchange",
  // voice calls: claim, renew, hang up
  "calls",
  // watchers: pages and feeds an agent keeps an eye on
  "watchers",
  // the daily brief and its settings
  "briefs",
  // scheduled work, made, changed and removed from a phone
  "routines",
  // incoming webhooks per agent
  "webhooks",
  // what your agents know about you
  "notes",
  // GET /api/plan-usage for a paired device, not only this machine
  "plan-usage",
  // GET and POST /api/threads/:t/messages/:id/redo: what redoing a
  // message the agent already read would take back, and doing it
  "redo",
  // reply.settled on the event stream: a turn's reply, said once when the
  // turn is over, which a desktop in remote mode waits for before it
  // stops announcing replies as they land
  "reply-settled",
  // the private settings-request frame an inspection puts on the owner's
  // stream, and POST /api/settings/device-report: a window's answer to it,
  // or a paired phone's own settings, also sent as it connects and when
  // one of them changes
  "device-settings",
  // GET, POST and DELETE /api/engine-pauses: engines and models paused
  // for a while, and `waitsFor: "pause"` with `waitsUntil` on a message
  // held for one
  "engine-pauses",
  // codexText on a bot's text and joinedTurnId on the person's, in history
  // and on the stream: Codex narration another agent's turn produced, to
  // show as work and never alert for (shared/codex-text.d.ts)
  "codex-progress",
  // files shared into a conversation: names with folders in them, byte
  // ranges (?range= through Bloks Cloud), GET /api/artifacts/resolve for
  // a link that is a path, and video among the types a viewer opens
  "shared-files",
  // people on an agent's Telegram bot: personId and action (allow,
  // decline, remove) and discardPending on the Telegram route, people and
  // upgradeNotices in its status, tg-person: request ids on /respond, and
  // telegramPerson and telegramSent on messages. Without it a phone shows
  // every Telegram message as the owner's and offers no admission.
  "telegram-people",
  // POST /api/live-activities: a phone's Live Activity tokens, so this
  // computer can start an activity for the person's own turn and end it
  // while the phone sleeps
  "live-activities",
  // Codex speed: codex.speed on GET and PATCH /api/config, an agent's
  // codexSpeed on PATCH /api/bots/:id, and a running lane's codexDispatch
  "codex-speed",
  // GET and PUT /api/memory/shared, its journal and undo: one MEMORY.md the
  // person keeps for every agent, with memory.changed for botId "_shared"
  "shared-memory",
  // GET /api/memory/search?q=: every agent's memory and the shared memory
  "memory-search",
  // GET /api/bots/:id/memory/stats (lines and bytes against what a turn
  // loads, topics with sizes and times), and changedAt on each topic
  "memory-stats",
  // POST /api/bots/:id/memory/copy: topics and picked MEMORY.md lines from
  // another agent, journaled so the copy can be undone
  "memory-copy",
  // the incident desk: GET /api/incidents and /api/incidents/:id,
  // POST /api/incidents/:id/resolve and /retry, `incidents` on
  // GET /api/activity, on PUT /api/config and on a brief, an `incident`
  // on a notice for its card, and the `incidents` frame on the stream
  "incidents",
  // routines and watchers that stop running on their own after failing
  // three times in a row: `failures` and `failing` on each in
  // GET /api/routines and /api/watchers, cleared by any PATCH, `failing`
  // on a brief and on GET /api/activity, and `failing` on its notice
  "automation-failures",
];
