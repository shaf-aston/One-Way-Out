# What Herdr actually reports about a pane

`wayfinder:research` · AFK · blocked by: nothing · assignee: —

## Question

Which facts about a running agent come from Herdr itself, and which does this app
invent in the browser?

Specifically: `working`, `done` and `idle` all appear on the map today. Does Herdr
report three states, or fewer? Is there a last-activity time per pane — the fact a
`no signal` state would need to tell a crashed agent from a finished one? Is
`blocked` a Herdr fact or is it derived from reading the screen?

Answer with the exact field names and where each is produced (`src/herdr.mjs` for
what the CLI gives, `src/model.mjs` or `public/*.js` for what is invented).

**Why it blocks:** *The states, and the order that decides which one wins* cannot
be written until it is known which states there is evidence for. A state derived
from a fact that does not exist is a hardcoded guess wearing config's clothes.
