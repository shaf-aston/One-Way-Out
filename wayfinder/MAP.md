# Map — One-Way-Out, blended with Agent Orchestrator and Yao

`wayfinder:map` · local-markdown tracker · tickets in `wayfinder/tickets/`

## Destination

**A written spec for One-Way-Out that an agent can build without asking another
question.** It takes the way Agent Orchestrator and Yao handle *connections
between agents* and *what you actually do with them*, and blends those into this
app cleanly — one coherent design, not features bolted on the side. Every state,
column, word and threshold lives in `config.json`; no rule is written in code.

Done when nothing is left to decide.

## Notes

- **Domain:** twelve Claude agents running in Herdr terminal windows on one
  Windows machine; a zero-dependency Node web page at `127.0.0.1:4785` that shows
  them all at once and types into them.
- **Standing constraints** (from `CLAUDE.md`, do not re-litigate): no build step,
  no framework, no npm dependency, no paid API key. Transport / pure core / swap-seam
  layering holds. Nothing reaches a live agent without a confirmation.
- **Nothing hardcoded** is a *hard* requirement this time and it goes further than
  tunables: state names, the order that decides which state wins, column titles and
  the words on screen are all data in `config.json`. Code holds the machine that
  reads rules; it never holds a rule.
- **Plan, don't build.** This map produces decisions. No app code changes while it
  is open, except where a ticket is explicitly a task.
- **Two repos are the source material:**
  `github.com/Untrivial-ai/agent-orchestrator` (a supervisor for fleets of coding
  agents — derived board columns, one git worktree per agent, a persistent planner
  above the workers) and `github.com/YaoApp/yao` (one board reachable from desktop,
  phone, browser or API; a task you repeat becomes a saved agent).

## Decisions so far

<!-- one line per closed ticket -->

- [What Herdr actually reports about a pane](tickets/01-what-herdr-actually-reports.md) — `working`,
  `blocked`, `done`, `idle`, `unknown` are all Herdr's own `agent_status`, read in `src/model.mjs`.
  Nothing is invented. There is **no** last-activity time, so `no signal` cannot be built yet.
- [The states, and the order that decides which one wins](tickets/06-the-states-and-what-order-wins.md) —
  four states in `config.json`, first match wins: needs you · your turn · working · quiet. `done`
  is now worded **Your turn**, which is what it means. `src/state.mjs` holds the machine, no rule.
- [What the board groups by](tickets/07-what-the-board-groups-by.md) — **by state**, one column each,
  the window boxes are gone. Built on branch `board` in the `one-way-out-board` worktree.
- [What one card shows](tickets/11-what-one-card-shows.md) — name, folder, how long, and its
  coloured edge. The status word came off: the column above it already says that, and two names
  for one fact is what broke it in the first place.

## Not yet specified

Fog. In scope, not sharp enough to ticket:

- **How the spec gets built once it is written** — one agent, several, in what
  order, on which branch. Cannot be phrased until the spec's size is known.
- **What happens to what is already saved** — one workflow in
  `~/.claude/herdr/flows`, one connections file in `~/.claude/herdr/wires`. If the
  connection model changes, these either migrate or are dropped. Waits on
  *The one connection model*.
- **Whether reading an agent's screen changes at all.** `public/reader.js` and the
  agent view are the most finished part of the app and may be untouched — but if a
  card grows facts, some of them may have to come from the screen text.
- **Where the twelve-agent limit is.** Nothing here has been tried at thirty.

## Out of scope

Ruled beyond the destination. Does not return unless the destination is redrawn.

- **Their stack.** Agent Orchestrator is Electron + React + Tailwind on a Go
  daemon, 2,528 commits. This app opens instantly because it has none of that.
  Layout and rules are taken; machinery is not.
- **Pull-request and CI columns.** Five of the six project folders are not git
  repositories, so the facts those columns derive from do not exist here.
- **Yao's low-code engine** — its JSON DSL, model/flow/script runtime. A different
  product that happens to live in the same repository.
- **Bindu** — identity, signing and payments between agents. Unrelated.
