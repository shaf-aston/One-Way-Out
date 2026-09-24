# Map of this repo

One line per thing. Paths are exact and greppable. Regenerate whenever a file is
added, moved, or deleted.

## Start here for…
- **A change to how the map looks** — `public/app.css`, then `public/index.html`
- **A screen that repeats itself / spinner noise** — `collapseRepaints` in `public/reader.js`
- **A menu answered wrongly, or not clickable at all** — `public/menu.js`, then `src/answer.mjs`
- **A new question you want answered for every agent at once** — `config.json` `prompts.known`, never code
- **A change to the agent viewer** (reading, replying, keys, pictures) — `public/agent-view.js`
- **A change to connecting agents** (drag, arrows, the kind menu) — `public/connect.js`
- **A new keyboard shortcut** — `public/keys.js`, and nowhere else
- **A change to the guide** (its words, its tabs, its pictures) — `public/guide.js`, pictures in `public/guide/`
- **A new API route** — `server.mjs`, with the thinking in a new/existing `src/*.mjs`
- **A change to what an agent is told when connected** — `src/team.mjs`
- **A question answered for every agent at once** — `config.json` (`prompts`), then `src/prompts.mjs`
- **Talking to Herdr differently** — `src/herdr.mjs` and nowhere else

## Directories
- `public/` — everything the browser loads. Open when changing anything visible.
- `src/` — pure logic, no I/O, no DOM. Open when changing what the app *decides*.
- `scripts/` — the checks. Open when adding a case to `verify.mjs`.
- `presets/` — ready-made workflows shipped with the app, so no panel is blank.

## Files
- `server.mjs` — transport: routes, JSON, static files. No rules of its own.
- `config.json` — every tunable value: port, poll interval, timeouts, folders.
- `package.json` — two scripts, zero dependencies.
- `Start One-Way-Out.bat` — the Desktop shortcut's entry point.

### public/
- `public/index.html` — the markup, plus the glue: poll, render the grid, route.
- `public/app.css` — every look the app has; design tokens in `:root`, nowhere else.
- `public/agent-view.js` — one agent's live screen: read, reply, press keys, send pictures, full page.
- `public/connect.js` — drawing lines between agents, the kind menu, the send-one-job bar.
- `public/wires.js` — the lines themselves and what they mean. Draws nothing.
- `public/flows.js` — the Workflows panel: build and run a chain of agent steps.
- `public/reader.js` — turns a terminal's own ANSI colours into HTML, and draws a repainted spinner once. Pure.
- `public/menu.js` — what a menu Claude is waiting on looks like, and the one key to press next.
  Pure, and the single owner: the browser draws the rows as buttons, the server walks the highlight.
- `public/router.js` — what a URL means. Pure, and the only place a link is spelled.
- `public/keys.js` — the one list of every key. Add a key here or it is not a key.
- `public/guide.js` — the guide behind **?**: four tabs, real screenshots of this app, and the key table and connection meanings generated from the app's own lists.
- `public/ui.js` — shared view helpers: DOM, escaping, fetch, header message, slash palette.

### src/ (pure — covered by `npm run verify`)
- `src/herdr.mjs` — the ONLY file that runs the Herdr CLI. The swap-seam.
- `src/model.mjs` — turns a Herdr snapshot into workspaces → tabs → panes, plus counts.
- `src/collisions.mjs` — which folders have more than one agent in them. Reports only; changes nothing.
- `src/team.mjs` — connection kinds, the exact line each connected agent is told, and reading drawn lines as teams.
- `src/flows.mjs` — what a valid workflow is (trust boundary), and which agent a saved step still means.
- `src/runner.mjs` — walks a workflow: send → wait for idle → next.
- `src/image.mjs` — what counts as an image, decided by the file's own first bytes.
- `src/commands.mjs` — reads the slash commands and skills this machine has.
- `src/projects.mjs` — the folders offered when starting an agent.
- `src/store.mjs` — reading and writing the saved JSON files.
- `src/prompts.mjs` — which question an agent is stopped on, and the keys that answer it.
- `src/ids.mjs` — id shapes and slugs; the reason nothing can walk the filesystem.

### scripts/
- `scripts/verify.mjs` — every pure-logic check. One file, run by `npm run verify`.
- `scripts/fixtures/repaints.txt` — a real captured pane full of repeated repaints, the material the loss check runs on.

## Written at runtime (not in this repo)
- `~/.claude/herdr/flows/` — saved workflows
- `~/.claude/herdr/shots/` — pictures pasted into a reply, kept so an agent can open them
