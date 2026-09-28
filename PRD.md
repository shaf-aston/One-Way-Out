# One-Way-Out — what it is for

> Anything marked **[assumed]** is a reading, not something the author stated — correct it freely.

## Purpose
Run several AI coding agents as one company, from one page: a mission, goals, an org chart,
issues as the unit of work, heartbeats that hand work out, budgets, approvals, and a log of
everything — the model of [Paperclip](https://github.com/paperclipai/paperclip), running on the
Herdr terminal already on this machine instead of a hosted stack.

**Who it is for:** one person running a team of coding agents on one machine, on a second
screen, glanced at constantly. Not multi-user, not hosted. **[assumed]**

## Must-haves — each one testable
1. **Nothing runs until you say so.** A new company is paused. Only **Run company** lets the
   heartbeat brief anyone, and **Pause** stops new work at once.
2. **Every piece of work is an issue with one owner.** An employee holds at most one issue in
   progress (atomic checkout), and an issue that waits on others never starts early.
3. **Done is proven, not guessed.** An issue finishes only when its agent writes a result file.
   A quiet agent is reminded once, then the issue is blocked and its manager gets an issue.
4. **Every brief carries the why.** The mission, the goal and any parent issue come first.
5. **You approve what agents propose.** Plans (issues, hires) and budget raises wait in the
   Inbox when the company says so; rejecting one tells its author why.
6. **Budgets stop runaway work.** Hitting a cap (issues a day, minutes a day, tokens a month)
   pauses the employee and asks you. Tokens are read from the agent's own screen, never guessed.
7. **Nothing is lost on restart.** A company is a folder; every call reads it fresh.
8. **Anything visible is one click from the agent itself.** A running employee, or any card on
   the Agents page, opens that agent's live screen to read and answer.
9. **Fast.** Every company page draws from one read, polled once; the Agents map polls only
   while it is showing; nothing needs installing or building.

## Non-goals
- Not a workflow builder or a canvas. No drawn lines, no drag-and-drop pipelines — structure
  comes from the org chart and issues. *(Wires, workflows and one-shot runs were removed on
  2026-09-28 in favour of the company model.)*
- Not multi-user, not authenticated, not reachable off this machine.
- Not a terminal replacement — Herdr is still where an agent lives.
- No framework, no bundler, no npm dependencies.
- No paid API. The app calls the local Herdr CLI and nothing else.

## Constraints
- One machine, one user. Windows first; runs anywhere Node and Herdr do.
- **No paid API keys, ever.**
- Must survive Herdr being closed and reopened without a restart.
- Must start instantly — no install step, no build.
