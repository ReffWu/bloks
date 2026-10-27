---
name: data-cleaning
description: Profile a dataset, fix what is wrong in a copy, and log every change so the analysis can be trusted
metadata:
  title: Data cleaning
  version: "1"
  author: Bloks
  tags: data, analysis, quality
---

Use this when a spreadsheet, an export or a dataset needs to be made usable before anyone analyses it.

1. Never change the original. Work on a copy, and keep the original's name and date in your notes.
2. Profile it first: rows, columns, types, empty cells, duplicates, values out of range, and dates or numbers stored as text.
3. Fix only what is clearly wrong, and log each fix: the column, the rule, and how many rows it touched.
4. Where a fix needs a judgement (which of two duplicates to keep, what a blank means), ask rather than choose.
5. Check totals and counts before and after. A cleaning step that changes a total should be one you can explain.

Not for: a single formula or lookup. Write that formula.
Return: the cleaned file, the change log, and the questions that still need an answer.
Approval: required before writing over any original file or sending data anywhere.
