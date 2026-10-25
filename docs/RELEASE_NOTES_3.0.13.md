**The Plan page stays private and current, and a silent turn's QUIET never flashes in the live preview.**

## What changed

- **Plan replies stay private and in order.** Plan responses are never cached, by the server or either desktop proxy. Only the window on this computer tells the app about your account, a device's own credential used on this computer counts as a device, a refused credential clears what the page shows, and an older read can no longer overwrite a newer one. The offline fallback is unchanged. Thanks @rpavlovs (#393)
- **QUIET stays out of live previews.** In the turns Bloks already treats as silent, a bare QUIET no longer flashes in the live preview before it is put away. Everything else about those turns is unchanged, and ordinary text streams as before. Thanks @rpavlovs (#394)
