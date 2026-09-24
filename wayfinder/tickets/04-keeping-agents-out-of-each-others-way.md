# Keeping agents out of each other's way, without git

`wayfinder:task` · HITL · blocked by: nothing · assignee: —

## Question

Five agents are editing `C:\Users\Shaf\Downloads\logistics-T4` at once. Three more
share `aRABIC GRAMMAR TOOL`, two share `vibe-code-projs`. **None of those three
folders is a git repository** — checked 2026-09-02; only `radio-dictate` is. So
there is no history, no branches, and no undo: when two agents write the same file,
one edit is gone.

Agent Orchestrator's answer is one git worktree per agent, created during spawn.
That is not available here, because a worktree needs a repository.

The task: run `git init` and one first commit in the three shared folders, then
confirm the working trees are clean and nothing was ignored that should not be.
After that, the worktree design becomes possible and can be specified.

**Why it blocks:** the isolation half of the spec cannot be written while the
premise it rests on is false. It is also the only item on this map that can lose
work while the map is open.
