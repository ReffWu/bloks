**Pair a phone with a server from your Mac, browser-style conversation tabs, pasted images that show up at once, and Codex questions you can answer.**

## What changed

- **Pair a phone from your own devices.** The owner can now pair a phone, with a code or a Bloks Cloud link, from a paired Mac connected to a server on another computer. The card names the computer the phones reach and explains what only that computer can do, such as turning phone access off. Agents and members are still refused. Thanks @po-trottier (#403)
- **Codex questions get a card.** When Codex asks a question without stopping to wait, Bloks now shows a question card you can answer, with its choices, and raises the usual question alert. Your answer goes into the running turn, or starts the next one if the turn has ended. Thanks @po-trottier (#402)
- **Browser-style conversation tabs.** ⌘T opens a new conversation, ⌘W closes the open one (asking first if it has messages, and never closing General), ⌘⇧W now closes the window, and ⌘⇧[ and ⌘⇧] step through conversations unless the terminal has the keyboard. Arrow keys move between focused tabs, and the File and Window menus list it all. Thanks @po-trottier (#401)
- **Start typing in a new conversation right away.** A conversation made from the tab strip, the sidebar, a menu or ⌘T puts the cursor in its message box. A slow one leaves you alone if you have moved elsewhere in the meantime. Thanks @po-trottier (#400)
- **Pasted images show up right away.** An image you paste, pick or drop appears in the composer at once, says whether it is preparing or uploading, and keeps a Retry button if it fails. Send waits for it instead of going without it. Thanks @po-trottier (#399)
- **Memory tidy never cuts a note in half.** A merged or reworded note longer than a line may be is refused whole, so the notes it would have replaced stay word for word. The tidy is now told the limit. Thanks @alexnayko (#404)
- **Read or drop a conversation's summary.** `bloks summary` shows what a conversation's older messages were summarised into, and `bloks summary --clear` drops one that is stale: the transcript stays, and the next turn replays it and summarises again when it fills up. A summary that runs past 8,000 characters is now cut where a line ends and says so, instead of losing its end without a word. Thanks @alexnayko (#405)

## For people who build Bloks

- `GET` and `DELETE /api/bots/:id/tasks/:task/summary` read and drop a conversation's summary. An agent may use them only on the conversation it is in.
- The pairing routes now accept the owner's own paired devices, as Bring your setup and server updates do. Turning phone access off and removing every device stay on the server's own computer.
