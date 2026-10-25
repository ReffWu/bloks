**Update a server from the app, bring your setup from any of your devices, and tabs that always show what is working.**

## What changed

- **Update your workspace server from the app.** Settings, About now shows this app's version and the workspace server's version separately, and says which one each update changes. For a bloks-server you run yourself, the owner can check for a newer release, read its notes and install it from the app: the download is checked against the release's checksum, unpacked beside the current version, switched to, and rolled back if it does not start. A server run by systemd, launchd, Docker or a hosted machine shows the steps to update it by hand instead. `bloks-server update` does the same from a terminal. A server on 3.0.13 or older needs one update by hand to get this. Thanks @po-trottier (#396)
- **Bring your setup from your own devices.** The owner can now use Bring your setup from a paired device against a server on another computer. The page names the computer it reads from, keeps the review before anything is imported, and says how to bring over a setup from the Mac you are on. Agents and members are still refused. Thanks @po-trottier (#397)
- **Tabs show what is working, right away.** A slow agent list no longer puts back older working or idle states, and a tab turns working or idle as soon as its turn starts or ends. Thanks @po-trottier (#398)
- **Quiet check-ins fold in member conversations.** Members see a run of quiet check-ins as one muted line they can open, as the owner does. Thanks @rpavlovs (#395)

## For people who build Bloks

- Each release now carries `bloks-server-<version>.tar.gz.sha256` beside the server tarball, written by `scripts/pack-server.mjs` and checked by the release workflow before upload.
