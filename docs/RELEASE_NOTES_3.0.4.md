**Telegram groups and tables, routine details you can read, and a few words made clearer.**

## What changed

- **An agent's bot can answer in a Telegram group.** Turn on Answer in groups in an agent's Telegram settings, once Telegram is paired, and its bot answers group messages that mention it or reply to it. Everything else said in the group is dropped unread. When you ask, the agent works as it does for you anywhere. Someone you let in gets the same limited turn they get in a private chat, even if you gave them full access there, and a stranger can only ask to be let in. Only the agent's answer reaches the group, as a reply to the message that asked; its working, cards and files stay in the app. Requests from the people you let in are capped at 30 an hour across an agent's groups, your own are not, and it is off for every agent until you turn it on. Thanks @rpavlovs (#348)
- **Tables arrive in Telegram as tables.** A reply with a table in it shows the table as a real one in Telegram instead of rows of pipes, with the words around it as before. A table too wide or too long for Telegram is sent the old way, and a reply to a table quotes its cells. Thanks @rpavlovs (#342)
- **Routine details you can read.** A routine's details now scroll, show its whole instructions and its last report formatted, say how long each run really took, and open the conversation a run happened in while it is still there. Thanks @rpavlovs (#352)
- **Codex's context reading is the agent's own.** When Codex ran a helper thread, its size could stand in for the agent's own context and decide whether Bloks compacted before the next turn. Only the agent's own thread is read now. Thanks @rpavlovs (#351)
- **"Use engine setting".** The reasoning effort choice that used to read Default now says where its level comes from, in the composer, an agent's settings and Settings, New agents. Thanks @rpavlovs (#349)
- **Tool actions, not steps.** A finished turn's line counts its tool actions, so it no longer reads like a goal's steps, which count whole turns. Thanks @rpavlovs (#350)
- **Up to date.** Electron 44.9, React 19.3.1, Zod 4.6.7, and the latest Radix dialog and switch.

## For contributors

- **A lost receipt's replay test counts once its turn has settled.** It counted the engine's calls a moment too soon on a slow machine and could fail for that alone.
