# Herdr Map — core flow

A local web page that shows every AI agent running in Herdr, lets you read and answer any of
them, wire them together, and start new ones — without touching the terminal.

## Where else to look

`PRD.md` what it is for · `MAP.md` where everything lives · `CLAUDE.md` how to work in here.

## Run it

```
node server.mjs        # http://localhost:4785, opens your browser
node scripts/verify.mjs # the pure logic checks (npm run verify)
```

## The flow, in seven steps

1. **Ask Herdr what exists** — `src/herdr.mjs` runs `herdr api snapshot`. It is the only file
   that talks to the Herdr CLI, so pointing this app at something else means editing one file.
2. **Turn the snapshot into a view** — `src/model.mjs` (pure) shapes it into workspaces → tabs →
   panes, counts the statuses, and lifts blocked/finished agents into "Needs you".
3. **Serve it** — `server.mjs` is transport only: it hands the browser JSON and static files and
   holds no rules of its own.
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
5. **Answer an agent** — typing in the viewer posts to `/api/pane/send`, which types the text into
   that pane and presses Enter. When the agent is waiting on a numbered menu, every option is
   clickable: `/api/pane/keys` presses ↑/↓/Enter for you, from a fixed allow-list in
   `src/herdr.mjs` (a key not on it fails the whole request, so half a sequence never lands).
   Under the box: **the mode pill**, which reads the agent's own status line (`readMode` in
   `public/reader.js`) to say whether it asks before each step, and switches it to *accepting
   all plans* by pressing Shift+Tab and re-reading until the screen agrees. A screen that does
   not say shows "unknown" and presses once — it never presses a guessed number of times.
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

## Words this code uses

| Word | Means |
| --- | --- |
| **pane** | one terminal rectangle in Herdr; its id (`w2:p1`) identifies an agent |
| **agent** | a pane Herdr has attached agent state to — a running Claude, not a bare shell |
| **workspace** | Herdr's top-level grouping, one per project on this machine |
| **status** | working · blocked · done · idle · unknown, straight from Herdr |
| **needs you** | agents that are blocked or finished — the only ones wanting attention |
| **connection** | agents wired together: one leads · side by side · colleagues — the code calls this a *team* (`src/team.mjs`, `/api/kinds`) |
| **kind** | which of those three a connection is; it changes what each agent is told |
| **brief** | the single line of text a connected agent receives |
| **wire** | one line drawn between two agents on the map — it *is* a connection, so it carries a kind |
| **workflow / step** | a saved relay: one agent, one message, then the next |
| **preset** | a ready-made workflow shipped in `presets/workflows.json` |
| **view** | a place with its own link — the map, workflows |
| **shot** | a picture pasted into a reply; saved to disk so the agent can open it by path |
| **mode** | what an agent does about permission: asks first · accepting all plans · planning only |
