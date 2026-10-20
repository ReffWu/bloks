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
the rest) and whatever connectors you configure, talking to their own
services, and Bloks Cloud when you turn it on, which carries sealed
traffic it cannot read.

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
