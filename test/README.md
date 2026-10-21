# Tests

```sh
pnpm test          # everything, some four thousand tests, a few minutes
pnpm test:watch    # rerun on change
node --test test/rooms.test.ts   # one file
```

No test framework. Node's built-in runner reads TypeScript directly, so
there is nothing to install and nothing to configure.

## What is here

| File | Covers |
| --- | --- |
| `http-guard.test.ts` | The origin and host checks. The security boundary. |
| `limits.test.ts` | Caps on anything reaching disk or a prompt. |
| `teams.test.ts` | Parsing a team plan out of model output. |
| `rooms.test.ts` | Who an `@mention` in a room actually wakes. |
| `skills.test.ts` | Skill filenames, and path traversal. |
| `house-style.test.ts` | The dash scrubber, and what it must not touch. |
| `models.test.ts` | Narrowing a provider's model list. |
| `reducer.test.ts` | Client state: where a message lands, cards settling. |
| `policy.test.ts` | Which rule answers, and what the wheel refuses. |
| `workflows.test.ts` | Steps, conditions, and what a bad one is refused for. |
| `activity.test.ts` | What a lane has stopped on, and what still wants you. |
| `components.test.ts` | Model-written JSON, checked before it reaches a screen. |
| `genui.test.ts` | Interface answers: the library, the parse, the tree kept for the phone. |
| `genui-actions.test.ts` | What a click in an interface answer may do, and what it may not. |
| `genui-briefing.test.ts` | What an agent is taught, behind its switch, end to end. |
| `workspaces.test.ts` | The desktop app's list of workspaces: the first launch leaves your folder where it is. |
| `access.test.ts` | Who may see what in a workspace with people in it, walked through one example. |
| `invites.test.ts` | Invite codes, links and passwords, and every way a request to join is turned away. |
| `workspace-join.test.ts` | Joining end to end, sealed, from the invite to the welcome. |
| `workspace-member-surface.test.ts` | A member's side against the real server: team, private and solo conversations. |
| `reads.test.ts` | How far people have read, and who may be shown it. |
| `spend-limits.test.ts` | A monthly limit on your own keys: what it counts, and that it stops a turn. |
| `model-prices.test.ts` | Estimating an unpriced turn from the list prices, with no network. |
| `palette.test.ts` | The colours, against the contrast they promise. |
| `api.test.ts` | The real harness over real HTTP. |

## How to write one here

**Test the property, not the implementation.** A test named "the longest
matching name wins" survives a rewrite of the matcher. A test named
"calls sort() before includes()" does not, and it found nothing when the
matcher was wrong anyway.

**Say why in the test.** When an assertion exists because of a specific
failure, put that failure in a comment. Someone will eventually want to
delete the line, and the comment is the only thing that will stop them.

**Prefer the real thing.** `api.test.ts` boots the actual server against a
throwaway home directory with no credentials and an empty `PATH`, then
makes the requests a browser would. Mocking the request path would have
tested the mock.

**Untrusted input deserves the ugly cases.** Model output, skill names and
anything from a page are attacker-shaped. The interesting assertions are
the ones about what must *not* get through.

## The integration harness

`helpers/server.ts` spawns `server/index.ts` with `HOME` pointed at a
temp directory, a random port, blanked credentials and `PATH=/nonexistent`
so no provider CLI can be found. That last part is deliberate: it puts the
server in the state a brand new user is in, which is where several of the
interesting behaviours live.

It cleans up after itself, and retries the cleanup: the server can
outlive its own SIGTERM by a moment, and removing the home while it is
still writing raises ENOTEMPTY, which fails a test that had already
passed. If a run is killed halfway, stale directories are under your
system temp as `bloks-test-*`.

A stand-in Claude Code CLI answers the first `user` frame, not the end
of stdin. Before it, the driver sends a bare `initialize` control request
for command metadata. A fixture can answer that request or ignore it.
The driver keeps stdin open for follow-ups until the first `result`, so
a stand-in that waits for the end waits forever.

What the stand-in prints for `--version` picks the protocol it is
driven on. Below 2.1.300 (most fixtures say `2.1.299`) the first real
`result` ends the turn. From 2.1.300 each `user` frame carries a `uuid`,
stdin stays open, and the turn ends only once every input has its own
`result` and a `command_lifecycle` frame saying it `completed`; a
stand-in that never says so leaves its turn waiting the fifteen minutes
`claude-inputs.ts` allows. Either way the turn's process group is
stopped before the turn is reported over.
