**An engine you can switch on and off in Settings, questions that wait beside the composer, quiet texts to Telegram, and bloks-server fixes.**

## What changed

- **Switch an engine on and off in Settings.** Each engine in Settings, Engines and keys has a switch. An engine that is off says Off ahead of Connected, starts no turns until you switch it on again, and the notice a refused turn leaves now points to that switch. Thanks @pycckuu (#421)
- **Questions wait beside the composer.** A question an agent is still waiting on, such as one Codex asks while it keeps working, now sits just above the message box, as wide as the box, instead of scrolling away with the conversation. Several at once scroll in their own space. What you type in an answer survives new output arriving. The conversation keeps a line where the question was asked, and its answer once you give it. Thanks @po-trottier (#415)
- **Agents can text you on Telegram, quietly.** `bloks telegram send --text "..."` sends a message of its own to the paired chat, formatted like an answer, code blocks included, so a tap copies them. `--silent` sends it, or a file, without ringing the phone. Thanks @alexnayko (#420)
- **One message that cannot be drawn no longer takes the conversation with it.** It shows a short note in its place, and the rest of the conversation stays readable.
- **bloks-server names the app's pages.** `bloks where` and the card `bloks open` leaves now name each Settings page on a server, as they do in the app. Thanks @rpavlovs (#417)
- **A container with the network off works on bloks-server**, and a file missing from an install no longer leaves a process waiting behind a failed turn. Thanks @rpavlovs (#418)

## For people who build Bloks

- `PUT /api/instances/:id/enabled` with `{ "enabled": true | false }` switches an engine, for the owner only. The switch is saved as `engineSwitches` in the config, by instance id, and wins over an `enabled` written into `instances`. Each engine's report now carries `enabled`.
- `POST /api/bots/:id/telegram/send` takes a `text` (up to 12,000 characters) or a `path`, never both, and `silent`. A text and a file share the same hourly limit.
- The bloks-server tarball now carries `bin/bloks-line.mjs` and `locales/en.json`.
- The network-off container test waits for its turn to end before removing its folder. Thanks @rpavlovs (#419)
