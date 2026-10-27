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
you configure, talking to their own services, and Bloks Cloud when you
turn it on, which carries sealed traffic it cannot read. A Chatterbox
server for voices must be on this computer or its local network (a
loopback, private or link-local address, or a local name): Bloks refuses
an address on the internet, since every reply read aloud is sent there
as text with no key. On a Mac with phone access on, the desktop app
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

**Approvals are the safety gate.** When a provider asks to do something
risky, Bloks surfaces an approval card and blocks until you answer.
Don't route around it. Engines reach Bloks over protocols that can carry
a permission request (Claude Code and Codex natively, Gemini CLI over
the Agent Client Protocol) precisely so this gate exists; a headless
"approve everything" mode is not used.

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
  `~/.bloks/skills` so a crafted name cannot escape the directory.

**Only install skills from a source you'd trust with your accounts.**
The same caution applies to anything an agent reads and treats as
instructions: web pages, issue comments, and email are untrusted input,
not commands.

**The macOS builds are signed and notarized.** Everything on the
Releases page is built by CI from a tag. The macOS `.dmg` and `.zip` are
signed with a Developer ID certificate and notarized by Apple, so they
open without a Gatekeeper warning and can be revoked if a build is ever
found to be compromised.

The Windows and Linux builds carry no signature. SmartScreen warns on
first run, and Linux does not expect one. If that matters to you, build
from source. See [docs/RELEASING.md](docs/RELEASING.md).

## What is not yet done

- Secrets are not in the Keychain. The desktop app keeps your Bloks key
  there, but each workspace's API keys are still in its `config.json`.
- There is no sandbox between an agent and the rest of your machine
  beyond what the provider CLI enforces. That includes agents a member
  of your workspace talks to: give a team agent only the folder and the
  tools you would let those people near.
