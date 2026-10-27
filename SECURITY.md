# Security

Bloks runs AI agents that can read your files, use your logged-in
accounts, and drive a computer. That makes a few things worth stating
plainly.

## Reporting a vulnerability

Open a private security advisory on the repository, or email the
maintainer. Please don't file a public issue for anything exploitable.

## The model

**Everything is local.** Agents, transcripts, configuration and skills
live on your machine, in the workspace's own folder: `~/.bloks` for
Personal, and a folder of its own in the app's data folder for every
other workspace. Bloks has no backend that holds your data, and nothing
you write is uploaded anywhere by us.

Bloks itself makes a few requests, none carrying your conversations: a
packaged build asks GitHub for the latest release on launch; npm is
asked whether an installed engine CLI has a newer release; browsing the
skill catalog fetches `https://bloks.dev/skills/index.json`, held for
half an hour (point it elsewhere with `BLOKS_SKILLS_URL`), and the team
gallery comes from bloks.dev the same way; while an engine runs on a key
of your own, OpenRouter's public model list is fetched at most once a
day, with no key and nothing about you, to estimate what unpriced turns
cost; and with a Bloks key, bloks.dev is asked, with that key, about your
plan. Everything else on the wire is the engines (Claude Code, Codex and
the rest), the voice vendors whose keys you save (the text being read
aloud, to ElevenLabs, OpenAI, Fish Audio or xAI), and whatever connectors
you configure, talking to their own services (with an app watcher on,
that includes a WebSocket to the realtime service Composio delivers
events through), and Bloks Cloud when you turn it on, which carries
sealed traffic it cannot read. A Chatterbox server for voices must be on
this computer or its local network (a loopback, private or link-local
address, or a local name): Bloks refuses an address on the internet,
since every reply read aloud is sent there as text with no key. On a Mac
with phone access on, the desktop app
also says on the local network where each listening workspace is (see
Phones and other devices).

**The harness server is loopback-only and origin-checked.** Each
workspace runs its own, Personal on `127.0.0.1:8799` and the others on
ports of their own, and none listens on your network unless you turn on
phone access for that workspace. But loopback alone is not a boundary. A browser will
happily send cross-origin requests to it from any page you visit, and a
CORS "simple" request skips preflight entirely. So every request is
checked: the `Origin` must be absent or loopback, and the `Host` must
name the loopback interface, which defeats DNS rebinding. See
`server/http-guard.ts`.

**Secrets sit in a plaintext file.** Each workspace's `config.json`
(`~/.bloks/config.json` for Personal) holds any API keys you paste,
written `0600` inside a `0700` directory. That keeps
other user accounts out, but it is not encrypted at rest. Moving these
into the macOS Keychain is the top open item.

**Which program runs as an engine is the person's choice, on this
computer.** An engine's CLI can be started from a path other than PATH's
copy. Only a window on this computer can set it (never a phone, a remote
window or an agent's token), the path must be a file that can run, the
Cursor editor is refused where the Cursor CLI is meant, and every change
is written to the activity ledger.

**Bringing a setup over copies a key only when you tick it.** Bring
your setup reads Claude Code's, Codex's, Cursor's, OpenClaw's and
Hermes' files under your home folder, read only, by name, and never
opens a file named like a credential (`auth.json`, `.credentials.json`,
`.env`, tokens, keys, OpenClaw's `credentials` folder). An MCP server's
environment and headers, and a chat app's token, arrive as names with
empty values. Each value is typed in by you, or copied from the other
tool's config because you ticked the box for that one value; a value is
never sent to the window, never put in the record of what was imported
or in what an undo keeps, and lands only where you would have typed it
(`config.json`). A chat app's token is checked with that app and saved
switched off. Rules an import makes are only ever as broad as the
original when they allow, and an agent's own tool limits become denies
for that agent alone. The routes answer only the owner, never an agent's
credential or a member, and every import can be undone.

**Approvals are the safety gate.** When a provider asks to do something
risky, Bloks surfaces an approval card and blocks until you answer.
Don't route around it. Engines reach Bloks over protocols that can carry
a permission request (Claude Code and Codex natively, Gemini CLI over
the Agent Client Protocol) precisely so this gate exists; a headless
"approve everything" mode is not used.

**Scripts are the owner, and ask like the owner.** `bloks-server run`,
`team apply` and `chat` ([docs/SCRIPTING.md](docs/SCRIPTING.md)) speak
as the person, so their routes (`/api/runs`, `/api/teams/apply`) answer
only this computer and the owner's own paired devices, never an agent's
credential or a member's device, and the commands refuse to run inside
an agent's turn. On another computer they take a paired device's token
from the environment or a file, never from the command line. None of
them answers an approval or a question on its own: a run that meets one
stops and says so, and the card waits in the app. Applying a team file
never deletes or archives anything and never touches an agent's engine,
keys or approvals.

**The renderer is pinned to its own origin.** The packaged app serves its
UI with a strict `Content-Security-Policy`: no remote script, no remote
frames, no form posts, and `connect-src 'self'`. The Electron window runs
with context isolation on and Node integration off, denies every
permission request except the two the app actually uses, refuses to
attach a `<webview>`, and hands any external link to your real browser
instead of navigating the app frame.

**Input is bounded.** Every field that reaches disk or a system prompt is
length-capped (`server/limits.ts`), oversized request bodies get the
socket closed rather than buffered, and an over-long message is refused
rather than silently truncated.

**Analytics are off unless you build them in, and blind when on.** There
is no analytics token in this repository. If you set `VITE_POSTHOG_TOKEN`
for your own build, autocapture, session recording and performance
capture are all disabled and text is masked, so only the named counters
in `src/lib/analytics.ts` are ever sent. No message content, agent name
or file path is included in any event.

**What a crash leaves stays here.** A native crash in any of Bloks'
processes leaves a minidump in this computer's crash folder, and the
crash reporter runs with uploading off, so there is nowhere it is sent.
macOS still writes its own report. The desktop app also keeps a small log
of its window and processes, `app.log` in its logs folder (on a Mac,
`~/Library/Logs/Bloks`), moved aside at 512 KB, never in a workspace's
folder and never sent off this computer. What the page writes to it is
budgeted, so a page failing in a loop cannot fill the disk.

## Phones and other devices

Your phone, a browser at bloks.dev/web or another computer of yours
reaches a workspace as a paired device, with a bearer token of its own;
the workspace keeps only its sha256. Pairing is the only way to become
one, so it is kept narrow. A member's device comes in through an invite
instead (see People in your workspaces).

- **A code exists only when you ask for one.** Phone access is off until
  somebody turns it on at the computer, and the workspace listens on the
  network only after Bloks restarts with it on. A six digit code and its
  QR are made when somebody presses Pair a phone, and the routes that
  make or cancel one answer only on this computer and on your own paired
  devices, which are the only way in to a workspace on a server with no
  screen; never a member's device or an agent's credential. A code works
  once, lasts five minutes, and five wrong tries close it. It is held in
  memory, never on disk, and the window closes it when the panel showing
  it closes. A pairing link, for a device on another network, works once
  for fifteen minutes and is shown only in those same places. Switching
  phone access off and removing every device answer only on the computer,
  since from a device they would cut that device off too. The one other
  way a pairing is made is for a phone you already paired, below.
- **Finding the computer again.** On a Mac, while phone access is on and
  the workspace listens on the network, the desktop app announces it on
  the local network as `_bloks._tcp` (`server/announce.ts`): the
  computer's name, the workspace's name unless it is Personal, the port,
  and a tag that is a hash of a random key in the workspace's folder.
  Nothing in it is secret, and nothing in it is trusted. Before a paired
  phone sends its token to a Bloks it found that way, it asks
  `POST /api/pair/prove` with a nonce, and only a Bloks that holds that
  phone's pairing can answer with the right HMAC. The announcement ends
  with the server.
- **Another workspace from a paired phone.** A phone you paired with one
  workspace can ask it which other workspaces of yours are on the
  computer, and for a pairing to one (`server/other-workspaces.ts`). Only
  your own paired devices may ask: never a member's device, an agent's
  credential or the computer's own window. Only your own workspaces are
  listed, never one you joined, and a pairing is made only for one that
  is already online with Bloks Cloud or listening for phones, which only
  the computer can switch on. It is single use, lasts three minutes, and
  comes back over the channel the phone is already trusted on; a device
  may have five in ten minutes. The computer shows a notification each
  time one is made, whatever its notification settings, naming the phone
  and the workspace it asked from.
- **Pictures of a screen.** While an agent works, its browser or cloud
  computer is pictured for the window and your phone, and a person can
  click, type, scroll and press keys in them from the chat or the phone;
  an agent's credential cannot. The Mac's own screen shows everything
  open on it, so it is held tighter. It is pictured only while an agent's
  turn is driving the Mac and your phone asks, at most about once a
  second, by the desktop app, which needs Screen Recording already
  granted and never asks macOS for it. That picture never goes on the
  event stream, is refused to an agent's credential, and is not a route a
  member's device can call. A member's stream carries no screenshots at
  all, and nothing on a phone can click on the Mac.

## The Bloks browser

The desktop app has a browser beside the chat that agents drive and you
watch (`electron/app-browser.mjs`, `server/app-browser.ts`). It is
signed in as you wherever you sign in, which makes it worth guarding.

- **Its own session, nothing of the app's.** Each workspace browses in a
  persistent session partition of its own (`persist:bloks-browser-<id>`):
  its cookies and storage are never the app's, and never another
  workspace's. A tab is a sandboxed `WebContentsView` with no preload, so
  a page has no `window.bloks` and no bridge to anything. Every
  permission a page can ask for (camera, microphone, location,
  notifications, devices) is refused except fullscreen and writing to
  the clipboard. Deleting a workspace clears its browser's data, and
  Settings, Browser signs out of every site at once.
- **Only the web.** A tab never goes to a `file:`, `chrome:`, `devtools:`,
  `javascript:` or `data:` address, or anything else that is not http or
  https, and never to a Bloks server on this computer, on any port a
  workspace or the app's own page uses, under any spelling of loopback.
  This is checked on every navigation and redirect, including the ones a
  page starts, and a page's requests to those ports are cancelled before
  they leave.
- **Who drives it.** An agent reaches it only through its turn's own
  credential (`/api/agent/browser`), and only in a turn the owner
  started in the owner's own conversations: never a member's turn, a
  shared room's, an unlisted email's or a Telegram person's, because the
  browser is signed in as the owner. Its settings, its picture and the
  route another app uses (`/api/browser`) are never reachable with an
  agent's credential. Another AI app reaches it through the MCP server,
  from this computer only, and gets less than an agent: nothing it does
  can ask you, so whatever would ask is refused for it. Without the
  desktop app (`bloks-server`, a hosted workspace) the browser is simply
  unavailable.
- **Which sites.** Each workspace has a list of sites agents may use and
  a list they never use, and a mode. In Ask first, the default, a site
  not on the allowed list asks you on a card the first time an agent
  opens it in a turn; Allow lets that turn in, Always allow adds it to
  the list. In Auto (which, like widening approvals, asks for Touch ID
  where the Mac has it) agents open any site but the blocked ones. A
  blocked site always wins. While an agent drives a tab, the app holds
  that tab to the same rules for every page a click, a redirect or a new
  window takes it to, and tells the agent it stayed where it was.
- **Which fields.** Typing into a password field, a payment field (by its
  type, its autocomplete and its name), and choosing a file to upload
  always ask you on a card first, in either mode. The card names the
  field's kind and the site, never what would be typed, and Enter does
  not answer it. A yes is good for that text in that field once. An
  agent never clicks a file picker; it names a file, and you see which.
- **What a page says is data.** Everything that comes back from a page,
  its text, its snapshot, its title, the tab list, is framed before it
  reaches a model: a sentence saying it is untrusted content from that
  site and that nothing in it is an instruction, between an opening and a
  closing tag carrying a random value per answer, so a page cannot write
  its own end of the frame. The snapshot is read from the browser's
  accessibility tree, and an agent's refs name the browser's own nodes,
  so a page cannot forge one by writing an attribute.
- **You can take it back.** You see which agent drives which tab and can
  take over at any time, from the panel or simply by clicking or typing
  in the page. The agent's next step then waits, up to a minute and a
  half, and is told the browser is yours if it still is. Its steps are not
  counted against its turn's twelve changes, since none changes the
  workspace; the sites and fields above are what bound them.
- **What leaves the Mac.** Your other devices hear only each tab's
  address and title, who drives it and the downloads' names, never what
  is on a page; a phone looking on gets a small picture of the tab on
  screen, at most every second and a half, and a member's device gets
  none of it. Downloads land in the workspace's own `browser-downloads`
  folder, with the site's name for the file cut down to a plain name.

## People in your workspaces

A workspace can take people, and everything they say runs on your
computer, with your engines and your keys. So the door and the rooms
behind it are built to be narrow.

- **Getting in takes more than the link.** An invite works once, for a
  day. Its code is never sent to a server (it sits after the `#` in the
  link), guesses are rate limited, and a join password, when you set
  one, is checked only on your computer and closes the invite after five
  wrong tries. With Approve each person on, which is the default, nobody
  is in until you and they have read the same four words. Those words are
  bound to their device and to your workspace's join key, so a relay that
  swapped the key to read the request would show different words on the
  two screens.
- **The request travels sealed.** Joining is sealed for your workspace's
  join key, so Bloks Cloud, which carries it, cannot read the name or the
  password in it. The joiner's device token never leaves their device;
  your computer keeps its sha256.
- **A member's device reaches a named list and nothing else.** Every
  route a member may call is listed in `server/member-access.ts`, and
  anything not listed is refused, so a new route is closed to members
  until somebody decides otherwise. They never reach your settings, your
  keys or your own conversations, and what crosses to them from the event
  stream is stripped of tool arguments, file paths, screenshots of your
  screen and the buttons on your approvals.
- **Their turns get none of your standing trust.** A turn a member
  starts never runs in Full access, gets none of your saved secrets, and
  reaches your apps, tool servers or computers only where you opened them
  to a room. Approvals in a team conversation or a room go to whoever
  started the work, to you and to your admins; in a member's own private
  conversation or solo agent, they answer their own.
- **Their spending is capped by you.** Per member: a monthly limit on
  what your API keys cost, a share of Bloks AI, how many solo agents they
  may make and which engines those use.
- **Private means private.** A member's one to one with an agent is
  theirs. You can turn on reading members' private conversations for the
  workspace, and every member is told which way it is set.
- **A room's Auto reads the room as data.** In a room set to Auto, a
  message that names nobody is shown to a small model, with the members'
  names, roles and briefs and the last few lines, so it can pick who
  answers. Anybody in the room, a guest from a chat channel included, may
  write words meant to steer it, so they go in as escaped JSON inside a
  block marked as data, and the answer must be one JSON object naming ids
  from the list it was given; anything else, or no answer in 2.5 seconds,
  and the lead answers. It can only pick agents the sender could have
  named in that room themselves (`mayAddressInRoom` in
  `server/access.ts`). By default it uses an engine the room's agents
  already run on, so the room's words reach no provider they were not
  already going to; a different one is your choice in Settings. Only you
  can set a room to Auto: an agent's credential may not, since each
  message then costs a call on your engine.

Who sees what is decided in one file, `server/access.ts`, as plain
functions a test can walk. Workspaces never share a folder, so an agent
in one cannot read another's memory, and the safety floor keeps agents
out of every workspace's folder, not only their own's.

## Skills are executable trust

A skill is markdown that gets injected into an agent's system prompt on
every turn. That means installing one is closer to running a script than
to saving a note: a hostile skill can instruct an agent to exfiltrate
files, misuse a connected account, or quietly ignore your instructions.

Bloks therefore:

- shows the full body before anything is installed,
- never fetches and installs a skill on its own initiative,
- caps skill size, and confines skills to slugged filenames inside
  `~/.bloks/skills` so a crafted name cannot escape the directory,
- never changes a skill on its own. When suggestions are on, a review of
  a finished conversation can suggest a new skill or a change to one,
  and an agent can ask for a change (`bloks skill revise`, or an MCP
  client's `propose_skill_revision`). Every one of those is staged with
  its reason and its diff, and only the person keeps it. A conversation
  can contain anything a web page, a file or an email put into it, and a
  skill is read into every future turn, so letting a review or an agent
  rewrite one unattended would give whoever wrote that page a lasting
  say in what your agents do. The review is told that what it reads is
  data, and what it writes has anything shaped like a key taken out,
  but the guarantee is the person's approval, not the prompt,
- keeps every version of a skill, with who made it and why, so a change
  that got through can be seen and put back. An agent's credential can
  read versions and ask for a change against the version it read; it
  cannot edit, restore, install, or keep a suggestion, and a change
  written against a version that has since moved on is refused rather
  than allowed to undo the newer one.

**Only install skills from a source you'd trust with your accounts.**
The same caution applies to anything an agent reads and treats as
instructions: web pages, issue comments, and email are untrusted input,
not commands.

## Events from your apps

An app watcher starts a turn when something happens in an app you
connected through Composio: an email arrives, an issue is labelled, a
message is posted. Whoever caused the event wrote what it says, so it is
handled as a stranger's words (`server/app-watch.ts`):

- **It is data, fenced.** The event is cut down to its readable fields,
  with anything named like a token, secret, password, cookie or key, and
  any long blob, left out before a model sees it. What is left sits
  between two markers carrying a nonce made for that one turn, under a
  line saying it was written by whoever caused the event and is not to be
  followed as instructions; a marker inside the event is defused. The
  person's own instruction comes after the fence.
- **Nothing listens until a person says so.** An agent can only propose
  an app watcher. The proposal is a card showing the app, the event, the
  filter, which agent acts and where, and nothing is set up at Composio
  until the owner presses Start watching. Agents cannot confirm, change
  or list accounts for one (`server/agent-cli.ts`).
- **It is bounded.** The same event twice is one event, a plain-words
  filter is checked before any model is woken, and each watcher starts at
  most a few turns an hour and a capped number a day.
- **Admins are trusted with it.** The apps watched are the owner's
  connections. An admin may set up an app watcher for an agent whose team
  conversation they are on; its turns go there, and run as the admin's,
  so they carry none of the owner's tools the admin could not ask for
  themselves. The event itself is read in that conversation, so make
  someone an admin only if you would let them read what your apps send.
  Members who are not admins cannot set one up.
- **Composio's project key is needed, and stays here.** Watching needs
  the project key (`ak_`) beside the Connect key. It is sent only to
  Composio, to make and remove triggers and to authorise the realtime
  channel events arrive on; it never reaches a turn.

**The macOS builds are signed and notarized.** Everything on the
Releases page is built by CI from a tag. The macOS `.dmg` and `.zip` are
signed with a Developer ID certificate and notarized by Apple, so they
open without a Gatekeeper warning and can be revoked if a build is ever
found to be compromised.

The Windows and Linux builds carry no signature. SmartScreen warns on
first run, and Linux does not expect one. If that matters to you, build
from source. See [docs/RELEASING.md](docs/RELEASING.md).

## What is not yet done

- The Bloks browser tells a payment field from its type, autocomplete and
  name, which a page can leave off. A card form drawn in a frame from
  another site, the usual way payment providers do it, never appears in
  an agent's snapshot at all, so you fill those yourself; a card field a
  page draws itself and names nothing is not caught. And a page can still
  show an agent anything: the frame says it is data, but a model can be
  talked into things.

- Secrets are not in the Keychain. The desktop app keeps your Bloks key
  there, but each workspace's API keys are still in its `config.json`.
- There is no sandbox between an agent and the rest of your machine
  beyond what the provider CLI enforces. That includes agents a member
  of your workspace talks to: give a team agent only the folder and the
  tools you would let those people near.
