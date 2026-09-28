# One-Way-Out

Run a company of AI coding agents in Herdr, from one page.

Give it a mission and goals. Hire agents as employees with a title, a job, a manager and a
budget. Work is issues. While the company runs, each employee picks up its next issue on its
heartbeat, does it, and writes back. You approve plans and hires, accept finished work, and
see everything that happened. The shape is [Paperclip](https://github.com/paperclipai/paperclip)'s;
the runtime is the Herdr you already have.

## What it does

- **Company.** A mission, goals under it, and an org chart. Start from a template (just a CEO,
  CEO + 2 engineers, or a full team) and edit anyone.
- **Issues.** A board you drag between To do, In progress, In review, Done. One assignee each;
  an employee holds one issue at a time; an issue can wait on others.
- **Heartbeats.** Employees wake on a schedule (or the moment work is assigned), check out their
  next ready issue, and are briefed with the mission, the goal, and the issue. A result file is
  the only proof it is done. Quiet agents are reminded once, then escalated to their manager.
- **Plan a goal.** The CEO splits a goal into issues for the team; the plan waits in your
  Inbox. Managers can delegate the same way, and ask to hire.
- **Budgets.** Per employee: issues a day, minutes of work a day, tokens a month. Hit one and
  they pause and ask you.
- **Routines.** Issues that create themselves: every N minutes, daily, or weekdays at a time.
- **Governance.** Approve or reject plans, hires and budget raises. Pause, resume, wake or let
  go of anyone. Nothing runs until you press **Run company**.
- **Activity.** Every change, by you, an agent or the heartbeat, in one log.
- **Agents.** The live map of every agent in Herdr. Read any one's screen, answer it, move it.
- **Many companies.** Each is its own folder. Export one to a file, import it elsewhere.

## Run

Needs Node 20+ and Herdr on PATH. No dependencies, no build step.

```
npm start        # http://localhost:4785
npm run verify   # pure-logic checks
npm run e2e      # the whole app in a browser, against a fake Herdr (needs global playwright)
node scripts/company.mjs list | state <id> | tick <id> --dry
```

Windows: `Start One-Way-Out.bat` runs it hidden. `Stop One-Way-Out.bat` stops it.

## Config

Every knob is in `config.json`: port, poll interval, Herdr binary and config path, where
companies are kept (`companiesDir`), and the heartbeat (`heartbeat.tickMs`, retries, timeouts,
how many agents may work at once).

## Layout

- `server.mjs`: thin transport
- `src/`: pure core. `src/heartbeat.mjs` decides; `src/office.mjs` carries it out; only
  `src/herdr.mjs` calls the Herdr CLI
- `public/`: the browser view, plain ES modules, one per page
- `scripts/verify.mjs`, `scripts/e2e.mjs`: checks

More: `CORE-FLOW.md` (how it fits together), `PRD.md` (what it is for), `MAP.md` (where things are).
