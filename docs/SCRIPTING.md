# Scripts, CI and the terminal

Three commands drive a workspace without a window. Each is the owner
speaking, exactly as typing in the app is: the same agents, the same
approvals, the same record.

```sh
bloks-server run Ada "Review the open pull requests and say which are ready"
bloks-server team apply team.md
bloks-server chat Ada
```

They come with `bloks-server` (`bin/bloks-server.mjs`) and need nothing
installed beyond Node 22.

## Which workspace

On the computer the workspace runs on, they find it the way the rest of
`bloks-server` does: `BLOKS_PORT`, then the port the running server
wrote down, then `config.json`. Being on that computer is the
credential, as it is for `bloks-server status`.

Another computer is named with `--server`:

```sh
export BLOKS_SERVER_TOKEN=...   # one of your paired devices' tokens
bloks-server run Ada "Draft the release notes" --server http://192.168.1.20:8799
```

That takes the token of one of your own paired devices, in
`BLOKS_SERVER_TOKEN` or a file named with `--token-file`, never on the
command line, where other accounts can read it in the process list. To
make one, press Pair a phone on that computer and trade the six digit
code it shows:

```sh
bloks-server token --server http://192.168.1.20:8799 --code 123456 --name "CI runner"
```

The token is printed once. The device is listed with your other paired
devices and can be removed there like any of them. A member's device and
an agent's credential are refused: these commands are the owner's.

A desktop workspace answers the network only with phone access on. A
`bloks-server` never does, so reach one from elsewhere through an SSH
tunnel, which arrives on its loopback like a command run there:

```sh
ssh -N -L 9800:127.0.0.1:8799 you@your-server &
BLOKS_PORT=9800 bloks-server run Ada "..."
```

## bloks-server run

```
bloks-server run AGENT "TASK" [--conversation NAME|new] [--json] [--export DIR]
                              [--timeout 30m] [--approve never|ask] [--quiet]
```

The task goes to the agent (by name, case forgiven, or id), and the
command waits until the agent and every teammate it handed work to are
done: a handoff with `bloks say`, the teammate's report back, the turn
that report starts, a failed turn asked again. Progress goes to stderr as
it happens, and the agent's final reply to stdout. `TASK` as `-` reads it
from stdin.

- `--conversation NAME` sends it to that conversation, made the first
  time a script names it; `new` makes a fresh one. Without it, General.
  A conversation made here does not take the screen in the app.
- `--timeout` bounds the run: `90s`, `15m`, `2h`, `0` for none. The
  default is 30 minutes. When it passes, the run is stopped, so nothing
  goes on spending unwatched.
- `--approve never` (the default): an approval or a question the agent
  raises ends the command with exit code 4 and the request on stderr. The
  card stays open in Bloks; nothing runs while it waits, and answering it
  there carries the work on. `--approve ask` asks at the terminal
  instead, when there is one. Neither ever answers on its own: what the
  workspace would ask you about, a script is asked about too.
- `--export DIR` copies what the run made into `DIR`: files a turn
  changed in its folder, at their paths there, as the turn left them, and
  files an agent saved as deliverables, by name. Deleted files are listed
  and not written.
- `--json` prints one document instead of the reply:

```json
{
  "status": "done",
  "exitCode": 0,
  "reply": "Three are ready: #412, #415 and #419.",
  "error": null,
  "run": "8f0c...",
  "agent": "Ada",
  "conversation": { "id": "3b1e...", "title": "General" },
  "turns": 3,
  "agents": ["Ada", "Ivy"],
  "files": [{ "kind": "change", "agent": "Ada", "path": "notes/review.md", "status": "added" }],
  "cost": 0.0412,
  "tokens": { "input": 18210, "output": 2311 },
  "duration": 48.3,
  "asks": []
}
```

`cost` is US dollars, or null when no engine said; `duration` is seconds.
`status` is one of `done`, `failed`, `stopped`, `timed-out`,
`needs-you`, `agent-not-found`, `refused`, `unreachable` or `usage`.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done: the agent and every teammate it handed work to finished. |
| 1 | Failed: the turn failed, or the run was stopped in Bloks. |
| 2 | Usage: a flag or the task was missing or wrong. |
| 3 | Timed out, and the run was stopped. |
| 4 | Needs you: an approval or a question is waiting in Bloks. |
| 5 | No agent by that name. |
| 6 | The server did not answer. |
| 7 | Refused: not the owner, a token it does not know, an archived agent, or Bloks finishing up to restart. |
| 130 | Ctrl+C, which stops the run. |

## bloks-server team apply

```
bloks-server team apply FILE [--dry-run] [--prune --yes] [--json]
```

Brings a room and its agents in line with a [team
file](ARCHITECTURE.md#teams-as-files), the same Markdown a room exports
and the hire dialog reads. Run it as often as you like: what is already
as the file says is left alone, and a second apply of one file changes
nothing.

- The room is the one with the team's name; it is made when there is
  none.
- A member with `name:` is that agent, wherever it is in the workspace,
  and joins the room if it is not in it. A member without one is the
  room's agent with that role, or a new hire with a name drawn the way
  the hire dialog draws one.
- A member's role, brief, skills and seniority are set as the file says,
  and its look only where the file states one. The most senior member
  leads the room. The team's blurb is said in the room as its brief when
  it changes.
- Nothing else about an agent is touched: its engine, model, folder,
  approvals, keys and memory stay as they are, and a hire gets the
  workspace's defaults for a new agent.
- `--dry-run` prints the plan and changes nothing:

```
Applying this file would change Launch crew:
+ hire a new agent as Researcher
~ Quill
    - description: Writes the announcement.
    + description: Writes the announcement and the FAQ.
  Juno, unchanged
  Pixel is in the room but not in the file; kept (--prune --yes takes them out)
Dry run: nothing was changed. 2 changes to apply.
```

- Nothing is ever deleted or archived. An agent in the room the file no
  longer lists stays, unless `--prune --yes` is given, which takes it out
  of the room; the agent itself stays in the workspace.

Exit codes: 0 applied or nothing to do, 1 the room could not hold the
team, 2 the file could not be read (the message names the line), 6 and 7
as for `run`.

## bloks-server chat

```
bloks-server chat AGENT [--conversation NAME|new]
```

A conversation in the terminal. It opens on where the conversation
stands, streams each reply as it is written, shows each tool call and
handoff on a line of its own, and asks an approval or a question inline:
type `allow` or `deny`, or a choice by number or name. Each message waits
until the agent and anyone it handed work to are done.

| Command | |
| --- | --- |
| `/new` | Start a new conversation with your next message. |
| `/stop` | Stop the turn that is running. Ctrl+C does the same and never quits. |
| `/model` | Say which model the agent runs on; `/model NAME` switches it. |
| `/help` | The list. |
| `/exit` | Leave. Ctrl+D too. |

Any other line starting with `/` goes to the agent, so an engine's own
commands work as they do in the app. Up and down walk back through what
you typed.

Piped, it reads one message per line, in order, each after the last
one's turn is done, with a card's answer taken from the next line, and
writes plain lines a script can match:

```
$ printf 'Summarise today\n/exit\n' | bloks-server chat Ada
Ada, in "General". Type a message, or /help.
  · Ada is working
  · Ada: Bash: git log --since=today
Ada: Four commits today, all on the importer.
```

## GitHub Actions

On a self-hosted runner on the computer `bloks-server` runs on, the job
speaks to it over loopback and needs no token:

```yaml
name: Nightly review
on:
  schedule:
    - cron: "0 6 * * 1-5"
  workflow_dispatch:

jobs:
  review:
    runs-on: [self-hosted, bloks]
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - name: Keep the team in line with the repository
        run: bloks-server team apply .bloks/review-team.md
      - name: Ask for the review
        id: review
        run: |
          set +e
          bloks-server run "Review lead" "Review what merged since yesterday and list anything risky" \
            --conversation nightly-review --timeout 40m --json --export review-out > review.json
          echo "code=$?" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v4
        with:
          name: review
          path: |
            review.json
            review-out/
      - name: Fail on anything but done
        if: steps.review.outputs.code != '0'
        run: |
          jq -r '.status + ": " + (.error // "")' review.json
          exit ${{ steps.review.outputs.code }}
```

Exit code 4 in a job means the agent asked for something only you can
allow: answer it in the app or on your phone, and the work carries on
there. From a hosted runner, reach the workspace through an SSH tunnel
or with `--server` and a token kept as a repository secret, passed as
`BLOKS_SERVER_TOKEN` in the step's `env`.

## What these commands can and cannot do

- They speak as the owner, so they are refused to an agent's credential,
  to a member's device, and from inside an agent's own turn (a shell
  with `BLOKS_TOKEN` set): an agent hands work to another with
  `bloks say`.
- They never answer an approval or a question on their own, and never
  change what the workspace asks about.
- A run is kept in memory. A restart of Bloks ends the run as the
  command sees it; the turns themselves are picked up as any cut off turn
  is, and their answer is in the conversation.
