# One-Way-Out — core flow

A local web page that runs a company of AI agents on Herdr: a mission, goals, issues, an org
chart, heartbeats, budgets and approvals — and underneath it, a live map of every agent that lets
you read and answer any of them without touching the terminal.

## Where else to look

`PRD.md` what it is for · `MAP.md` where everything lives · `CLAUDE.md` how to work in here.

## Run it

```
node server.mjs          # http://localhost:4785, opens your browser (Start One-Way-Out.bat runs this hidden)
node scripts/verify.mjs  # the pure logic checks (npm run verify)
node scripts/e2e.mjs     # the whole app in Chromium against a fake Herdr (npm run e2e)
node scripts/company.mjs list | state <id> | tick <id> --dry   # a company from a terminal
node scripts/where.mjs   # every project, the apps in it, how to run each
node scripts/fleet.mjs   # one plain terminal list of every agent, grouped by folder
```

## The flow

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
   holds no rules of its own. A POST changes a company or reaches a live agent — types into
   one, answers one, closes one — so a POST is refused unless it came from this page (`fromThisPage`); a
   page open in another tab can otherwise post to a local server without asking it first.
   Reads are left alone, because they change nothing.
   **Every key is in one list.** `public/keys.js` holds each shortcut with the words that
   describe it, and a module claims a key by name (`bindKey`) rather than by adding its own
   listener. A key that is not in the list is not a key. `public/guide.js` answers **?** and
   draws its key table from that same list, so it cannot drift out of date.
   **Where you are is a link.** `public/router.js` (pure) reads the address bar: `#/` is the
   Dashboard, `#/issues/acme-3` one issue, `#/agents` the map — each a place you can bookmark,
   reload into, and back out of with the browser's own Back button. Reading one agent is *not*
   a place — it stays a look on top of wherever you are.
4. **Draw the map** — the Agents page (`public/map.js`) renders workspaces as grid cells (each card showing a
   faint "how long in this status" mark, timed by this app since it first saw the change — Herdr
   itself keeps no clock), polls every 1.5s while it is the page on screen. The pane is read with its
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
6. **A company is a folder** — `src/companies.mjs` keeps each company under
   `~/.claude/herdr/companies/<id>/`: `company.json`, `goals.json`, `employees.json`,
   `issues.json`, `routines.json`, `approvals.json`, an append-only `activity.jsonl`, and `work/`,
   where agents write back. Every read is fresh, so a restart loses nothing, and every change goes
   through `withCompany`, one at a time per company, so the heartbeat and a click can never write
   over each other. What may be written is checked first, in `src/company.mjs` and
   `src/issues.mjs`, exactly as a destination or a menu answer is — a browser and an agent are
   both untrusted.
7. **One heartbeat** — every `heartbeat.tickMs`, `src/office.mjs` takes each running company,
   asks Herdr which employee is in which pane (by conversation id, which survives a move), and
   hands everything to `decide` in `src/heartbeat.mjs` — pure, so every rule is checked in
   `verify.mjs` without an agent in sight. In order, one beat:
   counts minutes worked and tokens (read off the agent's status line when a turn ends, never
   guessed); fires routines that are due; reads what agents delegated (`work/<issue>.delegate.json`)
   into issues, or into a plan in the Inbox; checks every issue in progress — **a result file
   (`work/<issue>.md`) is the only proof it is done**, a quiet agent is reminded once and then the
   issue is blocked and its manager given an issue to unblock it, and a manager whose team has
   finished is asked to check and sum up; pauses anyone over a budget and asks you; and hands each
   free, active employee whose heartbeat is due its next ready issue — one at a time (atomic
   checkout), never before what it waits on is done. The office saves the result, then does the
   slow part outside the lock: starts an agent if the employee has none (`claude --model <m>` in
   the company folder, beside its colleagues) and types the brief, nudging until the screen proves
   it landed — the same trust-menu and lost-Enter handling the old run builder measured.
8. **A brief carries the why** — `briefFor` gives an employee who they are, their job, who they
   report to and who reports to them, the mission ▸ goal ▸ parent issue, the issue itself fenced
   as data, the files only it may edit, your latest notes, and where to write its result — and,
   for a manager, how to hand work out and ask to hire.
9. **You are the board** — the pages in `public/` draw from one read of the company
   (`/api/c/<id>/state`) that `public/store.js` polls; every change posts and reads again at once.
   *Run company* is the only switch that lets the heartbeat brief anyone. *Plan it* on a goal
   gives the top of the company an issue whose whole job is to write a plan; with approvals on,
   that plan — and any hire — waits in the Inbox, and approving it creates the issues (their
   order becoming real `blockedBy` links) and the people. Finished work lands in Done, or in
   Review if the company reviews its own work; *Request changes* sends a note back and reopens
   it. A comment on an issue being worked reaches that agent straight away.

## Words this code uses

| Word | Means |
| --- | --- |
| **pane** | one terminal rectangle in Herdr; its id (`w2:p1`) is handed straight back to Herdr, never remembered |
| **agent** | a pane Herdr has attached agent state to — a running Claude, not a bare shell |
| **status** | working · blocked · done · idle · unknown, straight from Herdr |
| **state (map)** | the one word for what an agent on the map is doing — needs you · your turn · working · quiet, from `config.json` |
| **company** | a mission, goals, employees, issues, routines, approvals and a log — one folder |
| **employee** | an agent hired into a company: name, title, job, reports-to, model, heartbeat, budget; bound to its agent by conversation id |
| **employee state** | active · paused · over-budget · terminated — only active ones get work |
| **issue** | the one unit of work: one assignee, a status, a priority, a goal, a parent, what it waits on, files it alone may edit |
| **issue status** | backlog · todo · in progress · in review · blocked · done · cancelled |
| **checkout** | an employee taking its next ready issue; it holds one at a time |
| **heartbeat** | one pass of `decide` over a company; an employee's own heartbeat is how often it looks at its queue |
| **brief** | the single line of text an employee is given with an issue |
| **result** | `work/<issue>.md`, written by the agent — the only proof an issue is done |
| **delegation / plan** | `work/<issue>.delegate.json`: issues (and hires) an agent hands out; with approvals on, a plan in the Inbox |
| **approval** | something waiting for the board: a plan or a budget raise |
| **routine** | a schedule that creates one issue each time it comes round |
| **budget** | caps on issues a day, minutes of work a day, tokens a month; 0 means none |
| **lane** | the files one issue alone may edit; the same file on two open issues is a clash, shown on the board |
| **shot** | a picture pasted into a reply; saved to disk so the agent can open it by path |
| **mode** | what an agent does about permission: asks first · accepting all plans · planning only |
| **repaint / frame** | one drawing of the spinner; Herdr records every one, this app shows the run once |
| **menu / highlight** | the rows an agent is waiting on, and which one is selected — it *wraps*, so it is read, never counted |
| **question** | a menu an agent is stopped on that this app knows how to answer — described in `config.json` |
