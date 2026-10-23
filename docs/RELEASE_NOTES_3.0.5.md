**Usage that says whose it is, and Codex readings you can trust.**

## What changed

- **Usage status beside the writing box, not inside it.** A warning that you are near a limit now sits in a compact row under the box you write in, so it never takes the space you are typing in. It names which plan, allowance or key it means and the share used, with when it resets or how to top up. Dismissing it keeps your draft and where you were typing. Thanks @rpavlovs (#354)
- **No false alarms for Codex searches.** A Codex search that starts before its query is known is no longer counted as the same call over and over, so it cannot set off the warning about repeated identical calls. Searches with a query are counted as before. Thanks @rpavlovs (#353)
- **A new Codex session starts its context reading fresh.** When Codex replaced a session, the new one could inherit the old one's context size and show it as what a compaction started from. A replaced session now starts with no reading until it reports its own; recovering the same session keeps its reading. Thanks @rpavlovs (#355)

## For contributors

- **A test server gets thirty seconds to start.** On a loaded machine, CI's included, starting the server could take more than ten seconds and fail a test for reasons that had nothing to do with it.
- **The nightly tidy test runs the same at any hour.** Run in the small hours, it began inside a night the scheduler still owed a tidy, saw one run more than it counted and failed: every release built between about one and five in the morning, UTC, stopped on it.
