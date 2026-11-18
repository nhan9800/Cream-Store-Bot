# Agent harness

This workflow connects repo ownership, local checks, release evidence, and handoff. Use the smallest checks that cover the change, then use the existing release gate when deployment is requested.

## Begin a session

1. Read [AGENTS.md](../AGENTS.md), confirm the task's repo, and run the entry check listed there. Its output includes the branch, full commit, Node version, and whether the checkout has changes. Preserve edits you did not make. Give parallel tasks separate owned paths or worktrees.
2. In the shared Cenar workspace, use the existing Markdown Memory Bank. Read `.project-memory/INDEX.md` and `.project-memory/ACTIVE.md`, then open only the relevant topic links. A standalone clone can use the tracked guides and recent Git history, with fresh checks for anything missing.
3. Write down the requested behavior, the files or flow affected, and how to verify the outcome. If an outside system is involved, check its current state before choosing an action.

## Record verification

| Stage | Evidence to record |
| --- | --- |
| Local | Focused command, tested behavior, and result. Use production-like fixtures with test data. |
| CI | Actual run URL and conclusion for the commit being reviewed. |
| Release | Intended and observed revision, timestamp, and result of the read-only live checks listed in the deploy guide. |
| Handoff | Scope, work status, evidence, remaining blocker or next action. Update the existing record at milestones and before ending. |

Use `TODO`, `IN_PROGRESS`, `BLOCKED`, or `DONE` in the workspace record. Use `DONE` once the requested outcome has evidence. A successful local run or a merged PR is an intermediate result when the task includes a live release.

## Keep project knowledge reusable

| Place | What belongs there |
| --- | --- |
| This repository | Reviewable mechanisms, contracts, release checks, and durable engineering instructions. |
| Workspace `.project-memory/ACTIVE.md` | Current work, observed state, exact checks, and unresolved requests. Archive completed detail that is no longer current. |
| Workspace `.project-memory/FACTS.md` and `DECISIONS.md` | Stable facts and choices that later tasks must preserve. |

Keep credentials, customer records, SQLite data and recovery archives outside Git. The entry check validates repo-local guide links and rejects known private paths in the Git index. Check the proposed diff for sensitive content before sharing it.

## References

- The repo map, session handoff, and verification evidence apply the course's workflow for instructions, tools, environment, state, and feedback. [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering)
- The project uses local file-backed memory, isolated checkouts when needed, and existing test runners for the memory, execution, and verification layers. [Awesome Agent Harness](https://github.com/wangxumarshall/awesome-agent-harness)
- The workspace index, active state, facts, and decisions maintain Markdown context across sessions. [Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank)
- The repository entry map points to versioned guides and CI checks their links. [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)
