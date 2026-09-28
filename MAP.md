# Map of this repo

One line per thing. Paths are exact and greppable. Regenerate whenever a file is added, moved,
or deleted.

## Start here for…
- **What an agent is told** — `briefFor` in `src/heartbeat.mjs`
- **When work is handed out, retried, escalated or finished** — `decide` in `src/heartbeat.mjs`
- **What a valid issue, employee, goal or routine is** — `src/issues.mjs`, `src/company.mjs`
- **Budgets** — `src/budget.mjs`; **schedules** — `src/schedule.mjs`
- **A change to a page** — its own file in `public/` (`dashboard.js`, `issues.js`, …); shared cards and forms in `public/parts.js`
- **How the app looks** — `public/app.css`; design tokens in `:root`, nowhere else
- **A new API route** — `server.mjs`, with the thinking in `src/`
- **A new keyboard shortcut** — `public/keys.js`, and nowhere else
- **A change to the agent viewer** (reading, replying, keys, pictures) — `public/agent-view.js`
- **A menu answered wrongly** — `public/menu.js`, then `src/answer.mjs`
- **A question answered for every agent at once** — `config.json` (`prompts`), then `src/prompts.mjs`
- **Talking to Herdr differently** — `src/herdr.mjs` and nowhere else

## Directories
- `public/` — everything the browser loads.
- `src/` — pure logic (plus the two service files that do I/O: `companies.mjs`, `office.mjs`).
- `scripts/` — the checks and the terminal tools.

## Files
- `server.mjs` — transport: routes, JSON, static files, starts the heartbeat. No rules of its own.
- `config.json` — every tunable value: port, poll interval, heartbeat, folders.
- `package.json` — three scripts, zero dependencies.
- `Start One-Way-Out.bat` / `Stop One-Way-Out.bat` — the Desktop shortcut's entry and exit.

### public/
- `public/index.html` — the shell: header, the side rail of pages, `#view`.
- `public/app.js` — the glue: routing, the company picker, Run/Pause, forwarding events to the page on screen.
- `public/store.js` — the company on screen: one polled read, and `act()` for every change.
- `public/parts.js` — employee card, issue card, budget bars, and the issue/employee/goal/routine forms.
- `public/dashboard.js` — home: needs-you, stats, team, recent; first-run company setup and import.
- `public/issues.js` — the kanban, quick add, filters, and one issue's page.
- `public/goals.js` — the mission and goal tree, with Plan it.
- `public/org.js` — the org chart, hiring, and hiring an agent already running.
- `public/routines.js`, `public/inbox.js`, `public/activity.js`, `public/settings.js` — one page each.
- `public/map.js` — the Agents page: the live Herdr map, spawning, closing, shared-question answers.
- `public/agent-view.js` — one agent's live screen: read, reply, press keys, send pictures, full page.
- `public/reader.js` — turns a terminal's ANSI colours into HTML, draws a repainted spinner once. Pure.
- `public/menu.js` — what a menu an agent is waiting on looks like, and the one key to press next. Pure.
- `public/move.js` — moving an agent to another Herdr window or page.
- `public/tiers.js` — reporting lines read as tiers, for the org chart. Pure.
- `public/router.js` — what a URL means. Pure, and the only place a link is spelled.
- `public/keys.js` — the one list of every key.
- `public/guide.js` — the help behind **?**: four tabs, the key table generated from `keys.js`.
- `public/ui.js` — DOM, escaping, fetch, the header message, dialogs, the slash palette.

### src/
- `src/company.mjs` — companies, employees, goals, routines: checks, the why-chain, export/import.
- `src/issues.mjs` — issue statuses, checks, atomic checkout, what is ready, delegation files.
- `src/heartbeat.mjs` — one heartbeat as a pure decision, the brief text, approvals applied.
- `src/budget.mjs` — usage per day/month, caps, reading tokens off a screen.
- `src/schedule.mjs` — is a schedule due; a schedule in words.
- `src/activity.mjs` — the activity line and its filters.
- `src/templates.mjs` — ready-made starting teams.
- `src/companies.mjs` — service: a company's folder on disk, one change at a time per company.
- `src/office.mjs` — service: runs a heartbeat, starts and briefs agents via the seam.
- `src/herdr.mjs` — the ONLY file that runs the Herdr CLI. The swap-seam.
- `src/model.mjs` — a Herdr snapshot as workspaces → tabs → panes, plus counts.
- `src/state.mjs` — which column of the Agents map a card is in, from `config.json`.
- `src/collisions.mjs` — which folders have more than one agent in them.
- `src/moves.mjs` — where an agent can be put, and the arguments that put it there.
- `src/prompts.mjs`, `src/answer.mjs` — questions answered for every agent at once, and walking a menu.
- `src/image.mjs` — what counts as an image, from its own bytes.
- `src/commands.mjs`, `src/projects.mjs`, `src/labels.mjs`, `src/herdrsettings.mjs`, `src/ids.mjs` — slash commands, project folders, sidebar labels, Herdr's settings file, id rules.

### scripts/
- `scripts/verify.mjs` — every pure-logic check. One file, `npm run verify`.
- `scripts/e2e.mjs` — the whole app in Chromium against a fake Herdr, `npm run e2e`.
- `scripts/fixtures/fake-herdr.mjs` — a stand-in Herdr CLI whose "agents" do what their brief says.
- `scripts/fixtures/*.txt` — real captured panes the reader checks run on.
- `scripts/company.mjs` — a company from a terminal: list, state, a dry-run heartbeat.
- `scripts/fleet.mjs`, `scripts/where.mjs` — every agent by folder; every project and how to run it.

## Written at runtime (not in this repo)
- `~/.claude/herdr/companies/<id>/` — one folder per company (see `src/companies.mjs`)
- `~/.claude/herdr/shots/` — pictures pasted into a reply, kept so an agent can open them
