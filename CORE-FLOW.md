# One-Way-Out — core flow

A local web page that shows every AI agent running in Herdr, lets you read and answer any of
them, wire them together, and start new ones — without touching the terminal.

## Where else to look

`PRD.md` what it is for · `MAP.md` where everything lives · `CLAUDE.md` how to work in here.

## Run it

```
node server.mjs        # http://localhost:4785, opens your browser (Start One-Way-Out.bat runs this hidden; log: %LOCALAPPDATA%one-way-out.log)
node scripts/verify.mjs # the pure logic checks (npm run verify)
node scripts/where.mjs  # every project, the apps in it, how to run each, its vercel project
node scripts/fleet.mjs  # one plain terminal list of every agent, grouped by folder
node scripts/fleet.mjs --names          # spaces = the folder; the chat name sits on the line below
node scripts/fleet.mjs --names --watch 5 # keep doing that, so a new space numbers itself
powershell -NoProfile -File scripts/shot.ps1  # picture of the Herdr window (its sidebar is not a pane)
node scripts/fleet.mjs --link         # draft the "you share this folder" note per team
node scripts/fleet.mjs --link --send  # type those notes into the panes
node scripts/scratch.mjs --start 2    # throwaway agents in temp folders, to test writes against
node scripts/scratch.mjs --list       # what Herdr says about them (pane, terminal, conversation)
node scripts/scratch.mjs --end        # close them and delete their folders
node scripts/orch.mjs run "<goal>" [--folder <path>] [--dry] [--yes]  # same as #/run, from a terminal
node scripts/orch.mjs tree <id>       # a run's task tree and live status
node scripts/orch.mjs resume <id>     # pick a run back up after a restart
```

## The flow, in nine steps

1. **Ask Herdr what exists** — `src/herdr.mjs` runs `herdr api snapshot`. It is the only file
   that talks to the Herdr CLI, so pointing this app at something else means editing one file.
2. **Turn the snapshot into a view** — `src/model.mjs` (pure) shapes it into workspaces → tabs →
   panes, counts the statuses, and lifts blocked/finished agents into "Needs you".
   Each agent carries **the name you gave it** (Herdr's `name`/`label`), the title the chat gave
   itself as a quieter second line, and two ids that outlive a move: `terminalId` and `session`.
   The pane id is only ever handed straight back to Herdr — moving an agent reassigns it, so
   nothing this app remembers is keyed on it.
   **Agents sharing one folder are named on the map.** `src/collisions.mjs` (pure) groups the
   agents by the folder they work in and reports every folder holding more than
   `maxAgentsPerFolder` of them. They share one working tree with no undo, and the map groups
   cards by Herdr *window*, so until this they sat in separate boxes with nothing saying so
   (measured 2026-09-01: five agents in `project-a`). It reports; it never moves anything.
   **Which column a card is in is worked out, never stored.** `src/state.mjs` (pure) walks the
   ordered `states` list in `config.json` and takes the first whose facts all hold, so the board
   is a view of what Herdr reports and cannot disagree with it. The order IS the rule: measured
   2026-09-02, with nothing deciding which fact won, a "Needs you" heading sat over cards badged
   "Done". Cards used to be grouped by Herdr *window* — an accident of how the terminals were
   opened, which drew one folder as five boxes.

3. **Serve it** — `server.mjs` is transport only: it hands the browser JSON and static files and
   holds no rules of its own. Every POST here reaches a live agent — types into one, answers
   one, closes one — so a POST is refused unless it came from this page (`fromThisPage`); a
   page open in another tab can otherwise post to a local server without asking it first.
   Reads are left alone, because they change nothing.
   **Every key is in one list.** `public/keys.js` holds each shortcut with the words that
   describe it, and a module claims a key by name (`bindKey`) rather than by adding its own
   listener. A key that is not in the list is not a key. `public/guide.js` answers **?** with
   four tabs — what the screen is, how two agents are joined (in screenshots), the keys, the
   four pages — and draws the key table from that same list and the connection meanings from
   the server's own, so neither can drift out of date with what the app does.
   **Where you are is a link.** `public/router.js` (pure) reads the address bar: `#/` is the map,
   `#/flows` is a place you can bookmark, reload into, and back out of
   with the browser's own Back button. Inside one the map does not vanish: it narrows to a rail
   down the left so blocked agents stay visible while you work, and "Hide map" collapses that rail
   to give the view the whole window (remembered, and it never touches the URL).
   Reading one agent is *not* a place — it stays a look on top of wherever you are.
4. **Draw the map** — `public/index.html` renders workspaces as grid cells (each card showing a
   faint "how long in this status" mark, timed by this app since it first saw the change — Herdr
   itself keeps no clock), polls every 1.5s, and owns the agent viewer. The pane is read with its
   colours intact (`--format ansi`), and `public/reader.js` (pure) turns those into HTML two ways —
   **Reader**, a full-width block log (one strip per turn or tool call, Warp's block model — a
   "Tools" switch hides the tool-call strips and keeps only what the agent said to you) or
   **Terminal** (the screen line for line). Both choices are remembered in the browser, as is
   **Text size**, which cycles the agent's words through three sizes without scaling the
   buttons around them. A run of
   tool calls folds into one line you can open, and every message you sent is a chip that jumps
   back to it. A table the agent wrote is drawn as a real table, so its columns line up
   instead of collapsing into a row of pipe characters. All bold and colour come from the
   agent itself; nothing is invented.
   **The agent's spinner is drawn once, not thirty times.** Claude repaints its status and
   todo list in place every second; Herdr's capture records each repaint as new lines instead
   of overwriting them (measured 2026-09-01 — even `--source visible`, "the screen right
   now", carried six stacked copies), so the same block arrives twenty-odd times over. That is
   Herdr's own bug and this app cannot fix it. `collapseRepaints` in `public/reader.js`
   draws each run once, keeping the newest frame whole and every line an earlier frame drew
   that the newest one does not — so nothing is folded away and nothing is invented. Both
   views share it, because the duplication is a property of the lines, not of either view.
5. **Answer an agent** — typing in the viewer posts to `/api/pane/send`, which types the text into
   that pane and presses Enter. When the agent is waiting on a menu, every option is clickable.
   **A menu is walked, never spelled out in advance.** `public/menu.js` is the one place that
   knows what a menu looks like — both shapes: numbered (`❯ 1. Resume from summary`) and the
   plain cursor menu every new agent opens with (`❯ No, exit` above `Yes, I trust this folder`).
   Clicking a row sends its **words**, not its number, and `src/answer.mjs` presses one key,
   reads the screen, and decides again — pressing Enter only once the agent's own screen shows
   the highlight on the row that was asked for. That is not caution for its own sake: measured
   2026-09-01, **Claude's menus wrap** — one ↑ from the top row lands on the bottom row — so the
   older code, which pressed ↑ enough times to "park at the top" and then counted down, landed on
   a row that depended on where the highlight already was. It answered "No, exit" to the trust
   question and killed both test agents. Keys still come from a fixed allow-list in
   `src/herdr.mjs` (a key not on it fails the whole request, so half a sequence never lands).
   Under the box: **the mode pill**, which reads the agent's own status line (`readMode` in
   `public/reader.js`) to say whether it asks before each step, and switches it to *accepting
   all plans* by pressing Shift+Tab and re-reading until the screen agrees. A screen that does
   not say shows "unknown" and presses once — it never presses a guessed number of times.
   **Several agents stopped on the same question are answered together** — a bar at the top of
   the map offers that question's answers, and one click walks every waiting agent to it.
   Which questions those are, and which answers to offer, are written in `config.json`
   (`prompts`), never in code; each agent is walked on its own screen, so the same answer
   sitting on row 1 of one and row 2 of another is handled rather than guessed. The two shipped
   are resuming a long session and the trust question every new agent asks. Only *proceeding* is
   offered in that bar — quitting an agent is deliberately not one click away from all of them. Only agents that could be at a question are read, on their
   own slower clock than the map.
6. **Draw the connections, on the map itself** — drag the dot on an agent card to another agent and a
   menu asks what the connection means right where you dropped it; a labelled arrow appears
   (`public/index.html`, the `#links` layer). `public/wires.js` holds the lines and nothing else —
   there is no separate board, no canvas and no second place to connect agents. Once lines exist,
   one bar appears above the map: type one job and every joined-up group gets it, each agent told
   its own part (`/api/connections/dispatch` → `cleanWires` + `teamsFromWires` in `src/team.mjs`).
   Agents never message each other on their own — words move only when you draw a line and type a
   job, reply in the viewer, or run a workflow; the 1.5s poll only reads.
7. **Chain agents** — `public/flows.js` builds a workflow; `src/runner.mjs` walks it step by step
   (send → wait for idle → next), and reports honestly when an agent never looked busy.
   A step is saved against the agent's **conversation**, never the pane it sat in, and turned back
   into a pane the moment it is sent (`resolveTarget` in `src/flows.mjs`) — so a workflow still
   reaches the right agent after it has been moved, and a step whose agent has closed stops the
   run saying exactly that instead of messaging whoever holds that pane now.
8. **Move an agent, and see who leads whom** — the ⇄ on a card (or **M**) offers the three places
   Herdr has: its own window, its own page in a window, or beside the agents already on a page.
   `src/moves.mjs` (pure) decides the arguments, `movePane` in the seam runs them, and the
   terminal id is compared either side — a move that silently restarted the agent is reported as
   a failure, never as success. **Hierarchy** (`#/org`, **O**) is the same agents and the same
   connections arranged by rank instead of by window: `public/tiers.js` (pure) reads the lines as
   tiers, ready-made shapes come from `src/org.mjs`, and the arrows are drawn by the same
   `#links` layer the map uses. Lines are saved against each agent's conversation
   (`toSaved`/`fromSaved`), so they survive a reload, a restart, and a move.
9. **Build a team from one goal** — `#/run` (**R**) turns a goal into a task tree instead of
   you drawing one: a planner agent (`src/crew.mjs` `startRunPlan`) reads the target folder and
   writes `plan.json`, checked as a trust boundary (`src/plan.mjs` `validatePlan`, against
   config-driven caps) before you ever see it. You edit the tasks, then **Approve & run** spawns
   one pane per task with its own model (`claude --model <model>`) and its own brief. Every poll
   (`checkRun`) reads which tasks have written their result file — the only proof one is done —
   retries an idle one once, escalates to its leader if it still hasn't, and rolls a leader's
   team up into one merged summary once every child is done. A run is a folder, not a live
   process: `~/.claude/herdr/runs/<id>/` (`run.json`, `plan.json`, `tasks/<id>.md`, `report.md`)
   is read fresh on every call, so killing and restarting the server loses nothing.
   `scripts/orch.mjs` is the same thing from a terminal.

## Words this code uses

| Word | Means |
| --- | --- |
| **pane** | one terminal rectangle in Herdr; its id (`w2:p1`) identifies an agent |
| **agent** | a pane Herdr has attached agent state to — a running Claude, not a bare shell |
| **workspace** | Herdr's top-level grouping, one per project on this machine |
| **status** | working · blocked · done · idle · unknown, straight from Herdr |
| **needs you** | agents that are blocked or finished — the only ones wanting attention |
| **state** | the one word for what an agent is doing now — needs you · your turn · working · quiet. Defined in `config.json`, decided in `src/state.mjs`, and the only such word: the card no longer carries a second one |
| **connection** | agents wired together: one leads · hands its work on · side by side · colleagues — the code calls this a *team* (`src/team.mjs`, `/api/kinds`) |
| **group** | one connection's worth of agents, and therefore one job. `src/team.mjs` counts them and nothing else may — the browser counting too is how the number shown stopped matching the number sent |
| **kind** | which of those four a connection is; it changes what each agent is told, and how the line is drawn |
| **tier** | how far down the chain of command an agent sits; only *one leads* and *hands its work on* make tiers |
| **shape** | a ready-made set of connections applied in one click, then edited by hand (`src/org.mjs`) |
| **brief** | the single line of text a connected agent receives |
| **team (folder)** | agents whose `cwd` is the same folder — linked by where they work, no wire needed |
| **wire** | one line drawn between two agents on the map — it *is* a connection, so it carries a kind |
| **workflow / step** | a saved relay: one agent, one message, then the next |
| **preset** | a ready-made workflow shipped in `presets/workflows.json` |
| **view** | a place with its own link — the map, workflows |
| **shot** | a picture pasted into a reply; saved to disk so the agent can open it by path |
| **mode** | what an agent does about permission: asks first · accepting all plans · planning only |
| **repaint** | one drawing of the spinner and its todo list; Herdr records every one, this app shows the run once |
| **frame** | a repaint's header line plus the rows under it — what `collapseRepaints` collapses |
| **menu** | the rows an agent is waiting on — numbered, or a plain list with one row highlighted |
| **highlight** | which row the agent has selected right now; it *wraps*, so it is read, never counted |
| **question** | a menu an agent is stopped on that this app knows how to answer — described in `config.json`, never in code |
| **run** | one goal in progress: its own folder under `~/.claude/herdr/runs/`, holding the plan, every task's state, and its results |
| **plan** | the task tree a planner agent wrote — checked before it is ever shown or acted on (`validatePlan`) |
| **task** | one agent's job inside a run: a brief, a model, a lane, and who leads it (`parent`) or hands off to it (`after`) |
| **lane** | the files one task alone may edit; the same file claimed by two lanes is a clash, shown before you approve |
| **rollup** | once every task under a leader is done, the leader reads their results and writes one merged summary of its own |
