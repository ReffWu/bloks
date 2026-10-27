---
name: design-review
description: Review a technical design before it is built, for what will break, what it costs to run and what it rules out
metadata:
  title: Design review
  version: "1"
  author: Bloks
  tags: engineering, review, architecture
---

Use this when there is a design document, a proposal or a plan for a technical change, and someone wants it reviewed before the work starts.

1. Restate the problem and the chosen approach in three sentences. If you cannot, the document is not clear enough yet; say which part.
2. Read the code or system it changes before judging it. What exists today decides what is easy.
3. Look for, in this order: what happens when a part fails or is slow; data that could be lost, duplicated or read by the wrong person; how it is rolled out and rolled back; what it costs to run at ten times today's load.
4. Name the alternative the document did not consider that you would have, and what it would trade.
5. Separate blocking concerns from suggestions. Do not pad with style points.

Not for: reviewing finished code, or explaining how an existing system works. Read the code and answer that instead.
Return: a verdict (go, go with changes, rethink) in one line, then blocking concerns, each with the scenario that breaks, then suggestions.
Approval: none needed to review. Approving the design is the owner's call.
