# Which of the unproven pages survive

`wayfinder:task` · AFK then HITL · blocked by: *The one connection model*

## Question

`#/run` has completed **zero** runs — `~/.claude/herdr/runs` is empty. `#/flows`
holds one saved workflow and no evidence it has ever executed. Between them they
are the largest and most complex code in the app: `plan.mjs`, `crew.mjs`,
`runner.mjs`, six config knobs, and the riskiest changes made on 2026-09-02
(finding a step's agent by conversation instead of pane id; an unconfirmed spawn
now throws instead of sending anyway). All unit-checked. None executed against a
real pane.

The task: drive each one once, end to end, on a small real goal inside a scratch
folder — never against a live project — and record exactly what happens.

Then decide per page: keep as is, keep with a named fix, or cut.

**Why it blocks:** *How many places the nav goes*. Also settles whether the answer
to *What you actually do with this app* — "it never worked well enough to try" —
is true.
