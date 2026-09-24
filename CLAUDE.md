Follows `~/.claude/CLAUDE.md` — global brief + Development Lifecycle.

# One-Way-Out — project specifics

## Stack
Node ESM, no framework, no build step, no dependencies. The browser loads the
`.js` files in `public/` directly as modules. Do not introduce a bundler, a
framework, or an npm dependency without saying why first — "no build step" is
the reason this app starts instantly and never breaks on an install.

## Commands (verified)
```
npm start          # node server.mjs — serves http://localhost:4785 and opens a browser
npm run verify     # node scripts/verify.mjs — the pure-logic checks, no server needed
```

## Layers — logic only ever flows downward
- `server.mjs` — transport only. Routes, JSON, static files. Holds no rules.
- `src/*.mjs` — pure core. No I/O, no DOM. This is where the thinking lives and
  what `verify.mjs` covers.
- `src/herdr.mjs` — the only file that talks to the Herdr CLI (the swap-seam).
  Pointing this app at something else means editing one file.
- `public/*.js` — the view. Fetches, draws, listens. No business rules.

## Testing
Two kinds, both required for anything non-trivial:
1. `npm run verify` for pure logic — add a case there, never a new test suite.
2. **Playwright against the running app** for anything visible. A UI change is
   not done until it has been driven in a browser. Playwright is global at
   `C:/Users/Shaf/AppData/Roaming/npm/node_modules/playwright/index.mjs`.

## Never do these
- **Never send to, key, or close a real agent from a test.** `/api/pane/send`,
  `/api/pane/keys`, `/api/agents/close-all`, `/api/prompts/answer`,
  `/api/connections/dispatch`, `/api/flows/run` and `/api/run/approve` all reach
  Shaf's live sessions. Test scripts should add a `page.on('request')` guard that
  fails loudly if one is called — matching the **exact path**, because
  `/api/flows/runs` only lists runs and a prefix match blocks a harmless read.
- **`POST /api/terminal/settings` rewrites Herdr's real `config.toml`** (path: `herdrConfigPath` in config.json). Tests point it at a scratch copy and checksum the real file before and after.
- **A POST is a write even when it looks harmless.** `POST /api/wires` overwrites
  the connections he has drawn; `/api/flows/save` overwrites a workflow. A test
  may read one and post it back unchanged; it may never post a value it invented.
- **No paid API keys, ever.** This app calls nothing but the local Herdr CLI.
- Never weaken the image check in `src/image.mjs` — it decides what gets written
  to disk from a browser paste.

## Config, not constants
Every tunable lives in `config.json` (port, poll interval, timeouts, where files
are kept). `server.mjs` is the only reader; nothing else touches the filesystem
layout or the environment.
