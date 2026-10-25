**Members can use their conversations on a phone, and a muted workspace stays quiet on a server of its own.**

## What changed

- **Member conversations fit a phone.** In the member web app below 768 px, navigation now opens from the title bar in a drawer, so the conversation gets the screen. It keeps your draft, puts focus back where it was, and the desktop sidebar is unchanged. Thanks @rpavlovs (#390)
- **A server on its own keeps the workspace's mute.** A bloks-server running without the desktop app never heard the workspace's mute or notification level, so answer notifications ignored them. The server now keeps its own copy in its data folder. You set it from any of your own devices, and the desktop app sends it to your hosted and remote workspaces whenever it changes. Thanks @ashottonoyan (#391)
- **A join test asks the address it chose.** A LAN join fixture could follow an address already on the invite link instead of the test's own. Thanks @ashottonoyan (#392)
