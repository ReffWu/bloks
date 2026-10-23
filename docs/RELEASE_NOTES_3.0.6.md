**Twelve reports, answered: remote workspaces you can manage, engines that use what you attach, and files that open wherever you are.**

## What changed

- **Plan and billing from your own paired devices.** When your workspace runs on another computer, Settings, Plan on the Mac app or in a browser now shows your plan and opens Manage billing on the device you pressed it on. The key, Hosting and the other plan controls stay on the computer the workspace runs on, and the page says so. A plan that can't be loaded says so instead of looking like no subscription. Members and agents still can't reach any of it. Thanks @po-trottier (#357)
- **MCP apps from your own paired devices.** Check, opening an app and using its tools now work from your paired Mac or browser, on your network or through Bloks Cloud, not only on the workspace's own computer. Thanks @po-trottier (#356)
- **Codex uses the MCP servers you attach.** Codex now gets an agent's attached MCP servers, HTTP and stdio, on new and resumed conversations, with header and environment values kept off the command line. A server Codex can't use is named in the chat with the reason. Thanks @po-trottier (#358)
- **Custom endpoints can use tools.** Each custom OpenAI-compatible endpoint has a "This model can use tools" switch, off by default. With it on, the endpoint gets the same tools as the built-in API engines, and a host that refuses them ends the turn with a plain message. Thanks @po-trottier (#359)
- **Images reach models that can see them.** A custom endpoint can be marked "Sees images", and attached images then go to its model, which is what a llama.cpp server with its vision projector needs. OpenCode is sent images directly, and so is Gemini. An engine that isn't set to see images says the image wasn't sent. Thanks @jungleteam090 (#365)
- **Codex on a plan shows what it used.** The Usage page shows Codex's plan windows, how much is used and when each resets, where a dollar figure would be, next to this workspace's tokens and turns. Thanks @po-trottier (#360)
- **Large files open through Bloks Cloud.** A shared file bigger than about a megabyte now opens and downloads through Bloks Cloud in parts, up to 50 MB. Over that, the card says so, and `bloks share` warns the agent. Thanks @alexnayko (#366)
- **`bloks telegram send`.** An agent can send a file from its own folders to its paired Telegram chat, whatever started the turn, and is told whether it went. Thanks @alexnayko (#367)
- **Silence stays silent.** In a turn another agent, a job or a watcher started, a reply that is only QUIET is no longer shown, marked unread or sent as a notification. Thanks @po-trottier (#363)
- **Calendar jobs at the same time sit side by side.** Overlapping jobs in the Day and Week views share the slot's width instead of covering each other. Thanks @po-trottier (#361)

## On iPhone

- The Dynamic Island and Lock Screen show the right agent's look, and make it clear when more than one agent is working. Thanks @po-trottier (#362)
- Long-pressing an agent offers the desktop's actions, Clear conversation and Set a goal among them. Thanks @po-trottier (#364)

## For contributors

- **Tests keep out of your own Bloks.** Six test files that run a driver in their own process wrote its native log into the real home's `.bloks`. They now use a throwaway data folder of their own.
