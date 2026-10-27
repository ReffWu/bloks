---
name: postmortem
description: Write up an incident without blame, so the same thing is less likely to happen again
metadata:
  title: Postmortem
  version: "1"
  author: Bloks
  tags: engineering, reliability, incidents
---

Use this when an outage, a data problem or any incident that affected people is over and needs writing up.

1. Build the timeline from records (logs, alerts, messages, deploys), with times and time zone. Mark anything from memory as such.
2. Say who was affected, how, and for how long, in numbers where there are numbers.
3. Find the causes by asking why until you reach something the team can change. There is almost always more than one. Name systems and decisions, never people.
4. Note what went well: what limited the damage or sped up the fix.
5. Propose a few actions, each with an owner and a date, aimed at the causes, not the symptoms. Prefer one change that makes the failure impossible over three reminders to be careful.

Not for: an incident still in progress. Help fix it first; write this after.
Return: summary, impact, timeline, causes, what went well, and actions with owners and dates. Under two pages.
Approval: required before it is shared outside the team.
