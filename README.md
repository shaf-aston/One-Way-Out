# Herdr Map — live luxury view of your AI agents

A small local web dashboard that reads Herdr's live state and draws it as an
elegant, self-refreshing map: your workspaces and tabs as **levels**, each agent
lit by its **status** (working / blocked / done / idle), and a **"Needs you"**
lane for any agent that is stuck or finished. No clicking to refresh — it updates
itself every ~1.5 seconds.

## How to use it (the simple way)

1. Make sure **Herdr** is running (open the *"Herdr (AI agents)"* Desktop icon and
   start an agent by typing `claude` in a pane).
2. Double-click the **"Herdr Map (visual)"** icon on your Desktop.
3. Your browser opens the map. Leave it on a second screen and glance at it.
4. To stop it: close the small minimized window it left in your taskbar.

That's it. When an agent turns **orange (working)** it breathes; when it turns
**red (blocked)** it wants your input and jumps into the *Needs you* lane; when it
turns **green (done)** it's finished.

## How to test it works

- With Herdr open and **no** agents: the map shows *"Your workspace is quiet."*
- Type `claude` in a Herdr pane: within ~1.5s a card appears — no refresh.
- Close Herdr entirely: the map shows *"Waiting for Herdr"* and keeps retrying;
  reopen Herdr and it reconnects on its own.
- Check the pure logic: `npm run verify` — it covers the core modules (model, connections,
  workflow validation, folder listing, screen tidying). It does **not** click the panels; that is
  what the browser pass is for.

## How it's built (clean & modular)

| File | Role | Layer |
| --- | --- | --- |
| `config.json` | port, poll interval, herdr path, workflow timeouts — tunable, no code edits | config |
| `src/herdr.mjs` | the **only** module that talks to Herdr (snapshot, read, send, start) | swap-seam |
| `src/commands.mjs` | the **only** module that reads Claude's own `commands/` and `skills/` folders | swap-seam |
| `src/model.mjs` | pure transform: raw snapshot → view model + the agent roster | core |
| `src/team.mjs` | pure: a connection (kind + agents + job) → the line each agent is told | core |
| `src/flows.mjs` | pure workflow validation | core |
| `src/ids.mjs` | pure: the three id rules (pane id, saved-record id, slug) | core |
| `src/projects.mjs` | lists the folders you can start an agent in | core |
| `src/store.mjs` | the shared JSON-file store behind connections and workflows | service |
| `src/runner.mjs` | runs a workflow step by step: spawn → send → wait → next | service |
| `server.mjs` | thin HTTP transport: serves the page + the JSON endpoints | transport |
| `presets/workflows.json` | the ready-made workflows, editable without touching code | config |
| `public/index.html` | the map, the agent viewer, the new-agent dialog, all the styling | view |
| `public/ui.js` | shared view helpers: fetch, escaping, slash palette, screen tidying | view |
| `public/flows.js` | the workflow panel | view |
| `public/team.js` | the connections panel | view |
| `scripts/verify.mjs` | runnable checks for the **pure core only** — not the DOM panels | test |

Swap `src/herdr.mjs` to point at a different data source and nothing else changes.

## Closing agents

**Close all agents** (top right) shuts down every agent on the map; each workspace header
has its own **Close N agents** button for just that space. Both ask first, and both leave
plain shell panes alone — only panes Herdr reports as agents are closed.

## New agent

**＋ New agent** (or the **N** key) lists every folder under `projectRoots`, plus the ones already
running something. Click a folder, press Start, and Herdr opens `claude` there — it shows up on the
map within a second or two.

## Connections — wiring agents together

**Connect** (or **T**) opens the roster. Choose how the agents relate, tick who is involved, type
the job, and send. The line above the box always says in plain words what Send will do.

| Kind | What each agent is told |
| --- | --- |
| **One leads** | The ★ agent gets the job, hands parts out, waits, checks the work, reports back to you. Only it is messaged. |
| **Side by side** | Every agent gets the job and is told to claim its files out loud, so two of them never edit the same file. |
| **Colleagues** | Every agent gets the job as an equal and must check with the others before touching shared ground. |

Nothing is faked: each agent receives the real `herdr` commands to message, wait for, and read the
others, and it has to run them. Name a connection to save it — saved ones become one-click chips on
the map and inside the agent viewer. They live in `~/.claude/herdr-teams`.

## Agent manager

The **Workflows** button (top right) opens the manager. A workflow is a chain of steps
running left to right; each step picks a running agent **or starts a new one**, sends it
a message, and waits for it to finish before the next step starts. Type `/` in any
message box to see this machine's real commands and skills — the list is read from
`~/.claude/commands`, `~/.claude/skills` and the project's own `.claude/commands`, so
nothing is hardcoded and anything you add later just appears.

Saved workflows are JSON files in `~/.claude/herdr-flows` (change with `flowsDir`).

When a step's agent never looks busy, the step says so instead of claiming it finished —
that usually means a prompt (like Claude's first-run "do you trust this folder?") ate the
message.

## Honest limitation

Herdr's snapshot records each agent's **status** and the **level** it lives in,
but it does *not* store "agent A is waiting on agent B" as a saved link (Herdr
tracks waits as live events, not a stored graph). So this map does not draw
fake dependency arrows — it shows the real level tree and lights each agent by
its true status, which is what you actually glance for.

## Config

Edit `config.json`:
- `port` — default `4785`
- `pollIntervalMs` — how often to refresh (default `1500`)
- `herdrBin` — leave `""` to auto-detect; set a full path to override
- `openBrowser` — open your browser automatically on start
- `flowsDir` — where saved workflows live (default `~/.claude/herdr-flows`)
- `workflow.stepTimeoutMs` — how long one step may run before the chain stops (default 15 min)
- `workflow.settleMs` — grace period for an agent to start looking busy after a message
- `workflow.spawnReadyMs` — how long to wait for a freshly started agent to appear
- `workflow.maxConcurrent` — how many workflows may run at once
