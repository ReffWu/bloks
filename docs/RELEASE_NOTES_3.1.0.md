**Bloks in seven languages, agents in the notch, a browser you can watch, agents that act on your apps, and your runs exported for training.**

## What changed

- **Bloks in your language.** The whole interface, the menu bar included, now speaks English, Español, Français, Deutsch, Português (Brasil), 日本語 and 简体中文. It follows your system, or pick one in Settings, General, Language. A few things the server writes, such as notices and the morning brief, are still in English for now.
- **Working agents in the notch.** On a Mac with a notch, the agents at work show in it, with their own faces. Hover for what each is doing and a live timeline.
- **A turn's timeline.** The working line and a finished turn open a live waterfall of model calls, tool calls, waits and failures, beside the chat.
- **Agents act on events in your apps.** An app watcher starts an agent when something happens in an app you connected: an email arrives, an issue is labelled, a message is posted. Agents can propose one; nothing listens until you confirm it.
- **Skills that get better, and keep every version.** Agents suggest new skills and revisions from what a turn showed, as diffs. Nothing changes until you keep it, and every version can be compared and restored.
- **Drive Bloks from scripts and CI.** `bloks-server run`, `team apply` and `chat`, with JSON output and exit codes. See docs/SCRIPTING.md, with a GitHub Actions example.
- **Rooms can pick who answers.** Auto sends a message that names nobody to the agent whose role fits, and shows why above the reply. The lead is the fallback.
- **Cursor, Cline and three new voices.** Cursor and Cline run as engines, any CLI engine can start from a path you choose, and agents can speak with Fish Audio, xAI and Chatterbox.
- **Agents can work in a container or over SSH**, with Bloks as the only door back in.
- **A browser you can watch**, beside the chat, with take over and give back. Passwords, cards and uploads always ask you.
- **A catalogue of ready teams and skills**, each reviewed before it installs, with its connections off and its routines paused.
- **Bring your setup from Claude Code, Codex, Cursor and OpenClaw**: agents, instructions, skills, commands, tool servers and chat bots, each key copied only if you tick it, and the whole import can be undone.
- **Signal and Home Assistant.** Message your agents on Signal. Agents can read your home and change it only with your yes, and locks always ask.
- **Export your runs for training.** Settings, Data, Export for training writes your agents' runs to a JSONL file on your computer, in OpenAI's chat format with tools, ShareGPT, or Bloks's own timed trajectory. Choose agents, dates, engines and quality; keys are always taken out, and names, emails, phone numbers and your home folder by default. Other people's words stay out unless you ask. Preview before anything is written. `bloks-server export-runs` does the same from a terminal.
- **Agents can use Bloks itself.** A built-in guide teaches agents the `bloks` commands, and `bloks tab` lets an agent open a new conversation for itself or another agent it may message, with its first message, under the same rules as `bloks say`. Thanks @po-trottier (#408)
- **Agents explain Bloks, and show you the way.** Ask an agent how something works or where it is: a second built-in guide explains each feature, `bloks where` finds the page in the app's own settings index, and `bloks open` leaves a button in the chat that takes you there. An agent can also propose a change to a few everyday settings, like the nightly memory tidy or your brief's time, on a card with Change and Keep. Nothing changes until you tap Change, and approvals, keys, people, devices, plans, limits, backups and deleting stay yours.
- **A real badge on the Windows taskbar.** Bloks shows a red badge with the count, 9+ past nine, instead of a tiny copy of its own icon. Thanks @po-trottier (#407)
- **A new installer window**, with the agents' faces.

## For people who build Bloks

- The interface's words live in `src/locales`, one file per language, and `src/locales/README.md` is the translators' guide. `test/i18n.test.ts` fails on English written inline in a component.
- `POST /api/agent/conversations` opens a conversation for an agent, refused wherever `say` would be. The person's own route for an empty conversation stays theirs.
- `GET`, `POST /api/training-export` and `POST /api/training-export/preview` answer Bloks on this computer only. `bloks-server export-runs --help` lists every flag, `--no-metadata` included.
- The Home Assistant token is now taken out of errors and exports like every other saved key.
- The Settings index and the app's main places live in `server/settings-index.ts`, which the app and the server both read. `GET /api/agent/where`, `POST /api/agent/open` and `/api/agent/settings/proposals` are on the agents' list; the person's Change and Keep, `POST /api/settings-proposals/:lane/:message/(change|keep)`, is on the never list, and makes the Settings page's own request, recorded as `settings.changed`. `test/agent-guide.test.ts` fails on a Settings page the `how-bloks-works` guide does not name, and on a refused setting that does not say where to send the person.
