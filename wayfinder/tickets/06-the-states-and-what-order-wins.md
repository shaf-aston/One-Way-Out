# The states, and the order that decides which one wins

`wayfinder:grilling` · HITL · blocked by: *What Herdr actually reports about a pane*

## Question

Agent Orchestrator's rule: **display status is never stored**, it is computed from
facts every time, by one ordered list, first match wins. Their order is
`terminated → needs_input → PR and CI facts → working / no_signal / idle`.

Today this app shows "Needs you" as a heading over four green **DONE** badges,
because nothing decides which fact beats which.

Decide: the list of states, their exact words on screen, their colour tokens, and
the order. Then the shape of the `match` rule in `config.json` — equality on a
fact, and `over` / `under` on a number, is the proposal; anything richer means
writing an expression evaluator, which is a new language in a config file.

Include `no signal` if the facts allow it: an agent that should be reporting and
is not. Today a crashed agent and a finished one are the same grey.

**Why it blocks:** *What the board groups by* and *What one card shows*.
