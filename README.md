# One-Way-Out

Live visual map and control panel for AI coding agents running in Herdr.

See every agent at a glance. Read, answer, and connect them from the browser.

## What it does

- **Live map.** Workspaces and tabs as levels. Each agent lit by status: working, blocked, done, idle.
- **Needs you lane.** Blocked or finished agents jump to the top.
- **Read and reply.** Open any agent's transcript, send a message, answer its prompts.
- **Connect.** Draw wires between agents. One task, each agent told its own part.
- **Flows.** Save and run multi-agent workflows.
- **Terminal page.** Change Herdr's settings with switches, not a text file. Saves at once, keeps a dated backup.

## Run

Needs Node 20+ and Herdr on PATH. No dependencies, no build step.

```
npm start        # http://localhost:4785
npm run verify   # pure-logic checks
```

Windows: `Start One-Way-Out.bat` runs it hidden. `Stop One-Way-Out.bat` stops it.

## Config

All knobs in `config.json`: port, poll interval, Herdr binary, Herdr config path.
Set `herdrConfigPath` for your machine.

## Layout

- `server.mjs`: thin transport
- `src/`: pure core, no I/O. Only `src/herdr.mjs` calls the Herdr CLI
- `public/`: the browser view, plain ES modules
- `scripts/verify.mjs`: checks

More: `CORE-FLOW.md` (how it fits together), `PRD.md` (what it is for).
