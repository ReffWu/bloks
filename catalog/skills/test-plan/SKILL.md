---
name: test-plan
description: Plan the tests a change needs, aimed at how it could actually fail rather than at coverage
metadata:
  title: Test plan
  version: "1"
  author: Bloks
  tags: engineering, quality, testing
---

Use this when a change is planned or written and someone asks how to test it.

1. List what the change promises: each behaviour a user or another part of the system relies on.
2. For each promise, list the ways it could break: bad input, empty and huge input, the network or disk failing, two things happening at once, an old client or old data.
3. Choose the cheapest test that would catch each one: a unit test for logic, an integration test for anything crossing a boundary, a manual check only when nothing else can see it.
4. Follow the project's existing test conventions and helpers. Do not introduce a new framework.
5. Say what you are deliberately not testing, and why.

Not for: a failing test somebody wants fixed. Find why it fails and fix that.
Return: a table of promise, failure, test type and test name, then the list of what is left untested.
Approval: none needed to plan or to write tests. Pushing changes needs approval.
