---
name: engagement-kickoff
description: Bootstrap a Pattern 02 AI engagement — discovery scope, repo, eval plan.
kind: skill
maturity: alpha
owner_seat: engagement
inventory_id: skill-engagement-kickoff
refresh: quarterly
tags:
  roles: [engagement-lead, senior-ai, pm]
  stacks: [python, any]
  patterns: [pattern02]
  tools: [claude-code, opencode, codex]
when_to_use: "At the start of a new AI use-case engagement, weeks 1-2 of discovery."
allowed-tools: [Read, Write, Bash]
---

# engagement-kickoff

Drives the first two weeks of a Pattern 02 engagement: stand up the starter repo,
run the discovery interview guide, scope two use cases, and draft the eval plan
before any build starts.

## When to use

Day 1 of a new AI use-case-to-production engagement, before writing code.

## Steps

1. Scaffold the engagement repo (`arcos init pattern02 <dest>`).
2. Run the discovery interview guide; fill the current-state worksheet.
3. Score candidate use cases on the prioritisation matrix; pick two.
4. Draft the eval-criteria scoping template — evals are scoped now, not bolted on later.
5. Produce the MVP spec stub and the risk register from template.

## Notes

Customer data never enters the catalog. Engagement-specific outputs stay in the
engagement repo, which is git-clean of catalog internals.
