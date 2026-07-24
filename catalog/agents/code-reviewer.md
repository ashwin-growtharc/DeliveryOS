---
name: code-reviewer
description: Reviews changed code for quality, security, and maintainability.
kind: agent
maturity: alpha
owner_seat: senior-ai
inventory_exempt: true   # curated/generic; not a senior-ai IP row
refresh: quarterly
tags:
  roles: [senior-ai, ml-eng, engineer-generic, tech-lead, qa, devops]
  stacks: [python, typescript, java, any]
  patterns: [cross-pattern]
  tools: [claude-code, opencode, codex]
when_to_use: "Immediately after writing or modifying code."
allowed-tools: [Read, Grep, Glob, Bash]
---

# code-reviewer

Generic, stack-agnostic review agent curated into the catalog. Reviews recently
changed code for correctness, security, and maintainability; flags issues by
severity. Stack-specific reviewers layer on top via the `stacks` tag.
