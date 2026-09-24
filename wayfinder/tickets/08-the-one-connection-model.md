# The one connection model

`wayfinder:grilling` · HITL · blocked by: *How the two repos model one agent's relationship to another* · *What you actually do with this app, ranked*

## Question

The biggest decision on this map. Three models are currently in the same app:

1. **Lines you draw** between two agents, with four meanings — one leads, hands
   work on, side by side, colleagues (`src/team.mjs`, the map's drag handles).
2. **A saved workflow** — an ordered list of steps, each sent to an agent
   (`#/flows`, `src/runner.mjs`). One saved, never observed running.
3. **Describe a goal and a planner writes the task tree** (`#/run`,
   `src/plan.mjs` + `src/crew.mjs`). Zero runs on disk, ever.

Agent Orchestrator has one model: a persistent orchestrator above workers, and the
user draws nothing. Yao has one: conversation becomes tasks. Shaf has said he likes
how these two handle connections and use cases, and wants a **clean blend** — which
by definition is not three models side by side.

Decide: which single model survives, what the other two become (deleted, or a
surface on top of the survivor), and what the user physically does to relate two
agents.

**Why it blocks:** *Which of the unproven pages survive*, *how many places the nav
goes*, and what happens to the saved workflow and connections already on disk.
