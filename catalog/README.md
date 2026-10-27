# The Bloks catalogue

Ready teams and skills, installed from inside Bloks: Customize, then
Catalogue. Every item is reviewed with the person before anything is
created, and every download is checked against the fingerprint in
`index.json`.

```
catalog/
  index.json                 generated, never edited by hand
  teams/<id>.md              one team per file
  skills/<id>/SKILL.md       one skill per folder
```

## Adding a team or a skill

1. Fork the repository and add your file under `teams/` or `skills/`.
2. Run `node scripts/build-catalog.mjs`. It reads every file with the
   same parser the app uses, says what is wrong if anything is, and
   writes `index.json`.
3. Run `pnpm test`. `test/catalog.test.ts` fails when `index.json` is
   not what the build writes, or when a file breaks a rule below.
4. Open a pull request with the file and the new `index.json`. Say in a
   line who the item is for and when you would use it.

The quickest way to start is from something that already works for you.
In Bloks, open a room's menu and choose **Share as file**, or open a
skill on the Skills page and choose **Share as file**. Both write exactly
this format, with your workspace's keys, email addresses, phone numbers,
home folder and the project brief you gave a team taken out. Read the
file before you send it anyway: the job descriptions are yours, and only
you know what in them is private.

## A team

A team is the Markdown file Bloks already imports and exports: a block
at the top, then one `## Role` section per member, two to eight of them.

```markdown
---
name: Launch crew
blurb: Takes a feature from ready to announced.
tags: launch, product
author: Your name
version: 1
routine: weekdays 09:30 | Stand-up | One line each: what moved, what is stuck.
---

## Launch lead
seniority: 5
look: blue star
skills:
- Make the ship or hold call from the checklist
uses: launch-checklist

Runs the launch end to end and makes the final call.
```

- `blurb` is the line people read in the list. `tags`, `author` and
  `version` are required here; raise `version` with every change, so
  people who installed the team are offered the update.
- Exactly one member should have `seniority: 5`: the room reviews under
  its lead.
- `skills` are short lines folded into the member's role. `uses` names
  skills from `skills/` by id, which are installed with the team and
  attached to that member. A `uses` that is not in `skills/` fails the
  build.
- `routine` is `when | name | what to say` (the name is optional). When
  is `daily`, `weekdays`, `weekends` or day names, then a 24 hour time.
  In the top block it speaks to the room; in a member's section, to that
  member. At most eight in a team. They install paused.

## A skill

A skill is a `SKILL.md` in the open format: `name` and `description`
at the top, the instructions below, and anything else under `metadata`.

```markdown
---
name: launch-checklist
description: Check a launch is ready item by item, and name what blocks it
metadata:
  title: Launch checklist
  version: "1"
  author: Your name
  tags: launch, review
---

Use this when a launch is about to go out and someone asks if it is ready.

1. ...

Not for: planning a launch weeks out.
Return: the call first, then the blockers with owners.
Approval: none needed to check. Required before changing anything public.
```

- `name` is the folder's name: lowercase letters, digits and dashes.
- The body opens with `Use this when`, numbers its steps, and has the
  three closing lines: `Not for:` (when to leave it alone), `Return:`
  (what comes back) and `Approval:` (what needs the person first).
- A skill is read into every turn of every agent that uses it, so keep
  it short and specific. The limit is 16,000 characters; most good ones
  are under 1,500.

## What is not accepted

- Anything that sends, posts, pays, books, cancels or deletes without
  saying in `Approval:` that it asks first.
- Keys, tokens, passwords, personal details, or anything shaped like
  them. The build refuses the common shapes.
- Claims about third-party products or brands, endorsements, or
  instructions to use a particular paid service.
- Long dashes. The house style is a comma or a full stop.
- Instructions aimed at the model rather than the work: "ignore your
  rules", hidden text, or anything that would surprise the person
  reading the review.

Maintainers read every item before it is merged. Being in the catalogue
does not make an item trusted; the review in the app is where the person
decides.
