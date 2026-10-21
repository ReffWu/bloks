**Workspaces, the people you work with inside them, and a clear view of what your agents spend.**

The desktop app is out now. The iPhone and Apple Watch update follows as soon as the App Store has it.

The biggest release Bloks has had. Every part of your life with agents can now be a workspace of its own, each a whole Bloks with its own agents, memory, keys and rooms. A workspace can take people: send an invite, read the same four words, and they talk to your agents beside you, on your computer, within limits you set. A Usage page shows what every agent spent and puts a monthly line on your own API keys. And the app has a new shape, with answers drawn as cards, tables and charts instead of walls of text.

## Security

- **Shared files could be read from outside an agent's folder (GitHub 318).** Serving a file an agent shared checked its name, then opened it again by path. Something able to write in the agent's folder could swap the file, or a folder above it, for a link between the two, and the bytes would come from elsewhere on the computer. Bloks now opens the file once, refusing links on the way, checks that the open file is a regular file inside the folder, and sends its size and bytes from that same open file. Pasted images, skills, agent photos and memory, the app's own page, Move files and backups, and the desktop app's page proxy are read the same way. Reported by @ashottonoyan.

## Headline features

### Workspaces

- **A workspace for each part of your life.** Personal is the Bloks you already had. Add a Business workspace, or one with a name of its own, and each is a whole Bloks: its own agents, memory, keys, rooms, routines and settings. Nothing moves between them.
- **The switcher.** The workspace you are in sits at the top of the window with its mark. Its menu lists every workspace, with a dot where something is waiting, then Join a workspace, New workspace, Workspace settings and Mute. Cmd+1 to Cmd+9 and the command palette switch too.
- **Marks.** Choose a colour and pattern for any workspace of yours, from the Mac or the phone, or upload your logo; no two workspaces on the computer wear the same one. On a workspace you joined, the mark you pick is yours alone, and nobody else in it sees the change.
- **In your order.** Hold a workspace in the switcher and drag it, or use Option and the arrow keys. The order is the same everywhere workspaces are listed.
- **A start shaped by what you chose.** A new workspace opens on a short welcome that follows what you picked: inviting people for a team, its name and logo for a business, and nothing about members when it is just you.
- **They keep working while you look elsewhere.** Each workspace runs its own server, so routines and watchers go on in the background, and their approvals and questions still reach you. The Dock badge counts every workspace.
- **Mute and notifications, per workspace.** Mute one for 15 minutes, an hour, 3, 8 or 24 hours, or until you turn it back on. Choose whether it tells you about all activity, only what needs you, or nothing.
- **Reachable online, per workspace.** With Bloks Cloud, each workspace has its own space and its own switch, so your phone and the people you invite reach it from anywhere. One Bloks key covers every workspace on the computer.

### People in a workspace

- **Invite someone.** An invite is a QR code, an 8 character code you can read out, and a link that shows as an invite card in Messages, Slack and WhatsApp. It is for one person, works once and lasts a day. No email, and no account to make.
- **Nobody gets in by accident.** With Approve each person on, which it is unless you change it, you and they read the same four words before they are in. Add a join password if you like: it is checked only on your computer, and five wrong tries close the invite.
- **Roles.** You are the owner. Admins invite and manage people; members use the agents, rooms and memory.
- **Team agents.** In a workspace with people, every agent has one shared team conversation. Choose who is in it: everyone, only some people, or everyone except a few. Rooms are chosen per room, everyone or picked people.
- **Private one to ones.** Anyone who can reach an agent can also talk to it privately. Nobody else reads those unless you turn on "Owner and admins can read members' private conversations", and members are told which way it is set.
- **Agents message people for you.** In a team conversation or a room, you or an admin can ask an agent to message someone ("message Sam about the draft"), and it writes in Sam's private conversation, marked as sent on your behalf. Members cannot do that to each other.
- **Solo agents.** Members can make agents of their own, private to them, on the engines you allow.
- **Limits per member.** Set what each member may spend on your API keys a month, their share of Bloks AI, how many solo agents they may make and which engines those use. A member at their limit is stopped, and nobody else notices.
- **Join from the desktop app.** Join a workspace from the switcher with a link or a code. It opens beside your own as a member's app: the team agents you reach, your solo agents and your rooms. On the owner's own network you can join without Bloks Cloud at all.
- **Members come with Bloks Team.** Inviting people into a whole workspace needs the owner on Bloks Team. If that lapses, members are paused, never removed, until it is back.

### Conversations with more than two

- **Bubbles.** Rooms and team conversations draw every message as a bubble: yours on the right in your accent, everyone else's on the left with a face and a name. A chat with one agent stays as it was.
- **Seen by.** Faces under the latest message show who has read how far, with names on hover. They show only where another person is in the conversation, never for agents.
- **Your name.** Setup asks what your agents should call you, and Settings, General changes it. Bloks asks again before anyone else would see it, so no invite ever says "The owner". Two people who share a first name read as "Sam O." and "Sam K.".

### Usage and spending limits

- **A Usage page.** A new place on the rail shows what your agents used over 7, 30 or 90 days or this month, as cost, tokens or turns, for every agent and engine or one of each: a headline against the span before, a chart by day, and a breakdown by agent, engine or day that narrows the page with a click.
- **Spending limits on your own keys.** Put a monthly line on any engine that runs on an API key of yours. At the line, new turns on it pause, or go to the agent's backup engine, until you raise it or the month turns. A turn already running finishes.
- **Estimates where an engine names no price.** Most APIs report tokens and no price. Bloks now prices those turns from a public list of model prices, fetched at most once a day, and marks them with a "~". A model it cannot price is never guessed at, and you can give your own price per million tokens instead.
- **A notice before you run out.** The message box says "Approaching limit" or "Limit reached" when a Claude or ChatGPT plan window, Bloks AI or a spending limit is close, with the day it resets and View usage.

### Your plan, and Settings rebuilt

- **A Plan page.** Settings, Plan shows your membership as bloks.dev has it: its status and renewal, what it includes and how much of that is in use, your key (masked, to copy, replace or remove) and where it can go next. Without a key it says plainly that Bloks is free with your own keys.
- **Settings in one list.** Account, then Workspace, with which one beside it, then Agents, Integrations, Connections and Data. Search finds the very row a word lives on and takes you to it. The agent switches that crowded General have a page of their own, Behaviour.

### Answers drawn as interface

- **Pages that look finished.** Every agent can read a built-in Page design skill before it makes a page, report, dashboard or deck someone will open as a file: the answer first, depth that follows what is at stake, and readable on a phone and in dark mode. Every engine is told its short form too. Most answers need no file, and an agent's reply to one it made is a sentence or two, not a copy of the page.
- **Answers, not walls of text.** Agents can answer with cards, tables, charts, metrics, steps, tabs, forms and buttons, drawn as the reply streams. A click can answer the agent, open a page or change the answer itself, and nothing in an answer fetches anything. Switch it off for an agent with Interactive answers in its settings.
- **Comparisons in the chat.** With Interactive answers on, a comparison, prices or options to choose between are answered in the chat as interface, not as a file or a list in prose, even where earlier replies in the conversation did it another way. A file is made when you ask for a page, a report or something to keep.
- **Reply rules, read last.** The last thing every agent reads before it answers is a short How to reply: the answer in the first sentence, nothing extra nobody asked for, and a sentence or two when it made a file, since the card under the reply already shows it.

### A terminal that goes where you want

- **Several shells per agent.** Up to eight terminal tabs each, renamed, restarted or cleared from a menu, with the cursor, scrollback and text size your way.
- **Anywhere in the window.** Dock the terminal on any side of the chat, put it side by side with the chat, let it fill the window, or open it in a window of its own. Each side remembers its size.

## Everything else

### A new shape for the app

- **The main rail.** Chat, Overview, Automations, Memory, Plugins, Usage and Settings sit on a slim rail, beside the chat's own sidebar, which you can resize or fold away. Conversation tabs move up into the title bar.
- **Every side list sizes and folds.** Settings, Plugins, Memory, an agent's settings and Automations' lists resize and fold like the chat's, edged with a faint line in the colours of the mark. Folded, Settings becomes tabs along the top, and Plugins and Memory a small switch at the top left of the page, where their list was.
- **Overview reads as one page.** The morning brief as a short column with what waits on you first and a slim player for Listen, then Activity, Projects and Rehearsals.
- **The composer.** One slim row at rest, with the approval mode, the model and effort, Codex speed and a ring for context and today's spend underneath. Notices share one tray above it, and Send becomes Stop.
- **Replies read as prose.** Real paragraphs, lists and headings, and code coloured by language. Message actions sit in a quiet row that shows on hover.
- **Approvals say what will run.** A card shows the command, file, diff or page plainly. Commands that can delete or overwrite work are flagged and get no shortcut, and an answered card folds into one line.
- **Accent.** Pick an accent from the eight colours of the Bloks mark, for each workspace or the same everywhere.
- **Making agents and rooms.** A new agent is three short beats, with a draft ready in about four seconds. Agent settings open as a full page. A new room draws itself as you pick its members, and any member can wear the crown and lead that room.
- **Rooms show who is speaking**, stream each member's reply under its name, and read a handoff as one line.
- **First run, redone** as a full screen: engines as a live checklist, suggested agents, and approvals shown on a sample task.
- **Small things that add up.** Toasts, a proper confirm dialog, loading skeletons, a pill that jumps back to the latest message, starters for an empty conversation, and a command palette that lands on the message it found.
- **Plugins.** Each app has a page with things to try, 27 more apps are in the list, and Connect asks for the key right where you are.
- **The model menu** is one grouped, searchable list, with readable names for models an engine lists only by id.

### Memory

- **Memory is a place on the rail.** Shared memory every agent reads, About you, and every agent with how full its memory is, with a search, a journal of every change with its diff and undo, and copying notes from one agent to another.
- **A nightly tidy.** Each agent's memory is tidied once a night: notes past their date go, and the rest is merged and tightened as checked edits. A night undoes as a whole, and the morning brief says what changed. Turn it off in Settings, Behaviour, or tidy now from Memory.
- **Memory for agents on API keys.** They read and write their own memory too.

### Agents at work

- **Messages while an agent works.** Automatic reads what you send mid-turn: a stop stops, a correction or an answer to its question goes in now, and the rest waits for the turn to end. Or choose Interrupt or Queue, per agent or for the workspace. A quiet line under your message says what happened, and one press goes the other way.
- **An incident desk.** A turn that fails for good, a stalled call, or a routine, watcher or workflow that fails becomes an incident, handed to the room's lead, your most senior agent or the one you name, to retry once, pass on or tell you. An automation that fails three times running stops until you have a say, and the brief names what stopped.
- **Rules from your habits.** Approve the same thing five times in two weeks, with no refusal, and Bloks offers it as a narrow rule, in the agent's tray and above your rules. Nothing that deletes, moves money or touches credentials is ever offered.
- **Background work, your choice.** When an agent starts a subagent or a command in the background and answers before it is done, Let it finish (the default) keeps the turn open until that work is done and the agent has said what came of it; Stop when the reply is done ends the turn with the reply and stops it. Set it for the workspace in Settings, Behaviour, or for one agent in its own settings. A background subagent's notes no longer arrive as a reply after the turn has ended. Thanks @alexnayko (#331) and @rpavlovs (#325)
- **Separate tasks, counted apart.** The agents' turn limit counts every turn agents start in a row without you. You can now allow a budget across separate tasks in Settings, Behaviour: an agent names the task it hands off, each task's own run counts against the limit, and the whole chain against the budget. Off unless you set it. Thanks @pycckuu (#326)
- **Standing intents.** Words that come up in a conversation can post a note, bring an agent in or message one. Agents propose them and you approve them, in Automations, Intents.

### Automations and connections

- **Routines and watchers read as sentences.** Tap a part to change it, see the week ahead, and start from a common one.
- **The workflow editor is a full sheet**: the flow drawn as a chain, earlier answers as named pills, conditions as a sentence, and Try it lighting each step as it runs.
- **An agent can ask for its own Telegram bot.** Once it has made one with BotFather, it asks on a card that names it and the bot; you paste the token, which goes straight to its Telegram settings and is never shown to it. Thanks @alexnayko (#329)
- **Full access for one person on Telegram.** In an agent's Telegram settings you can give someone you let in full access, after a confirmation that the conversation and memory stay shared, and take it back. Their turns stay theirs: only they add to them and only they answer their cards. Thanks @rpavlovs (#320)
- **Saved secrets from any device.** Settings, Apps and keys, Saved secrets lists the secrets you saved for agents, by name, and forgets one, from the Mac or a paired device. Agents still cannot reach them. Thanks @alexnayko (#327)
- **Connections as checklists.** Telegram, phones, Slack, Discord, WhatsApp and Bloks Cloud each set up as a short list of steps that tick as they happen.

### Bring your history

- **Past conversations.** Find your Claude Code and Codex sessions and bring them over as conversations, from Settings or the first run, then carry one on from where it stopped.
- **Move a workspace in one file.** Backups can write out a whole workspace, and an empty workspace can take one in. Keys never travel; the ones left behind are named.

### Bloks AI

- **Agents with no key and no sign-in.** On a Bloks plan that includes Bloks AI, any agent can run on it, Claude Code included. Settings and Usage show what is left of the month as a meter, with top-ups, and a team can cap each member's share. Work nobody asked for, like the nightly tidy, uses it only when you switch that on.

### iPhone and Apple Watch

- With the iPhone app's own 3.0: workspaces in the sidebar, joining by link, QR or code with the same four words, a member's view of a workspace you joined, bubbles and Seen by, answers drawn natively as cards, tables and charts, Usage as a place of its own, and the usage notice in the composer.
- **Location, if you turn it on.** Your iPhone can tell your own computer where you are, as a place in words, and as an exact position only if you choose that too. Your own agents hear it while it is recent, and a watcher can act when you arrive at or leave a place. Members, shared rooms, Telegram people and strangers' mail never get it. Pause keeps it from agents and watchers, Off or Forget drops it, and only the last reading is kept: never a history, and never in a backup. Thanks @rpavlovs (#322)
- **Pairing that starts where you are.** Phone and devices walks you through your first phone, and a pairing code exists only once you ask for one. A paired phone finds your Mac again on its own when its address or port changes.
- **Your other workspaces in a tap.** A phone paired with one workspace lists your others on that computer and adds one in a tap, where phone access is already on there. The computer tells you each time.
- **Watch an agent work.** The phone shows an agent's browser or cloud computer live while it works, and you can take over with taps and typing. While an agent drives your Mac itself, the phone shows the Mac's screen, once Bloks has Screen Recording; that picture is yours alone, never an agent's or a member's.
- Notifications arrive from the agent with its face, Live Activities wear its colour, new widgets show who wants what, and Apple Watch answers approvals from your wrist.

## Fixes

- **Approvals work wherever a workspace's folder lives.** When a data folder's path was too long for a socket, an engine's permission requests were refused with no card and no notice. They now go through a short private folder, and a turn that still cannot start says why.
- **Folder watchers no longer wake on their own work.** A watcher whose turn renamed or filed what woke it read that as a new file and started the same work again.
- **A command longer than thirty seconds no longer ends a steered Claude turn under it,** and the next turn no longer resumes the same session in a second process. Thanks @alexnayko (#330)
- **An engine switched off in Settings starts no turn.** An agent on it answers on its backup, or says why it cannot. Thanks @pycckuu (#324)
- **Files attached on the Mac reach a workspace on another computer.** They are uploaded instead of named by their path on the Mac: files up to 20 MB and images up to 10 MB, and a larger one is refused with a sentence before anything is sent. Images over about 800 KB through Bloks Cloud work now too. Thanks @alexnayko (#332)
- **A changed working folder applies to the agent's existing conversations.** The agent starts a fresh session there, told the conversation so far, and the chat says where it now works. Thanks @alexnayko (#328)
- **An answer that does not fit is refused by name, not cut.** A table cell, quote, row or step past its limit used to be shortened or dropped while the agent was told it had worked; now the agent is told which field is over and by how much. Thanks @rpavlovs (#319)
- **A Telegram request's reply stays attached until its turn really ends,** however that turn ends. Thanks @rpavlovs (#321)
- **Agents are clearer about what to keep in memory** for later work. Thanks @rpavlovs (#323)
- **The desktop app stays quick in long conversations.** Each tool call used to rewrite the whole conversation on disk, and the window asked the server again on every update; under load that froze the app for a quarter second at a time. Calls are now written together, and the window asks only when it needs to.
- **A window that fails comes back.** If the app's page stops, it loads again, and after three times in a minute it says so with a Reload button. A part of the window that fails to draw shows a calm panel instead of an empty window. The app keeps a small local log, and crash reports stay on your computer.
- **The brief keeps sentences whole.** A filename such as post.md, a version or an address no longer cut a sentence in two and lost the first half.

## Thank you

This release is better for everyone who took the time to report what went wrong, try a build or send code. Thank you to @rpavlovs, whose pull requests and careful reports shaped Telegram, the backup engine, location and much of how agents hand work to each other; to @alexnayko, for the reports behind attachments to remote servers, saved secrets, working folders, background work and the Telegram bot card; to @pycckuu, for the engine switch and the task budget; and to @ashottonoyan, for reporting the shared-file issue privately and giving us time to fix it.

## Upgrading

- **Your data becomes the Personal workspace, untouched.** `~/.bloks` stays where it is, with everything in it: becoming a workspace moves nothing. New workspaces get folders of their own in the app's own folder. `BLOKS_DATA_DIR` moves Personal's folder, and `bloks-server`'s.
- **A workspace you join needs its owner on Bloks Team.** Without it, members are paused, with nothing deleted, until the owner's plan is back.
- **People you shared a room with stay guests of that room.** They are not made members of the workspace and see nothing beyond the room.
- **Settings moved, and old links still work.** Bloks Cloud is now Plan, the agent switches that sat in General are in Behaviour, and the Boat key is in Computers. A link to an old page opens the new one.
- **Places moved to the rail.** The brief, Activity, Projects and Rehearsals are on Overview; routines, watchers and workflows are in Automations; memory is Memory; skills and plugins are Plugins.
- **One key for every workspace.** The Bloks key you entered is kept once for the whole app, so putting another workspace online needs nothing typed.
- **Your phone stays paired with Personal.** To have another workspace on it, add it from the phone's workspace list, under your computer, or pair it from that workspace's Settings, Phone and devices.
