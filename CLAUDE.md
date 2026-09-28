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
npm run e2e        # node scripts/e2e.mjs — the whole app in Chromium, against a FAKE Herdr
```

## Layers — logic only ever flows downward
- `server.mjs` — transport only. Routes, JSON, static files, starts the heartbeat. Holds no rules.
- `src/*.mjs` — pure core. No I/O, no DOM. This is where the thinking lives and
  what `verify.mjs` covers. The two exceptions do I/O and decide nothing:
  `src/companies.mjs` (a company's folder) and `src/office.mjs` (carries out a heartbeat).
- `src/heartbeat.mjs` — every rule about handing out, checking and finishing work, as one
  pure `decide()`. Change behaviour here, then add a case to `verify.mjs`.
- `src/herdr.mjs` — the only file that talks to the Herdr CLI (the swap-seam).
  Pointing this app at something else means editing one file.
- `public/*.js` — the view. Fetches, draws, listens. No business rules.

## Testing
Two kinds, both required for anything non-trivial:
1. `npm run verify` for pure logic — add a case there, never a new test suite.
2. **Playwright against the running app** for anything visible. A UI change is
   not done until it has been driven in a browser. Playwright is expected in
   your global `node_modules` (`npm i -g playwright`). Extend `scripts/e2e.mjs`:
   it starts its own server on a scratch config with `herdrBin` pointed at
   `scripts/fixtures/fake-herdr.mjs`, so the heartbeat can run for real against
   agents that are only rows in a JSON file.

## Never do these
- **Never send to, key, or close a real agent from a test.** `/api/pane/send`,
  `/api/pane/keys`, `/api/agents/close-all` and `/api/prompts/answer` reach your
  live sessions directly. Test scripts add a `page.on('request')` guard that fails
  loudly if one is called — matching the **exact path**.
- **A running company briefs real agents.** The heartbeat starts and types into
  agents whenever a company is running, so these reach live sessions too:
  `/api/c/<id>/company` with `running:true`, `/api/c/<id>/employees/wake|resume|terminate`,
  `/api/c/<id>/plan`, `/api/c/<id>/approvals/decide`, and `/api/c/<id>/issues/comment` on
  an issue in progress. A test only ever drives them with `herdrBin` pointed at the
  fake and `companiesDir` in a scratch folder — `scripts/e2e.mjs` asserts both before
  it clicks anything. Never run a test against your real `companiesDir`.
- **`POST /api/terminal/settings` rewrites Herdr's real `config.toml`** (path: `herdrConfigPath` in config.json). Tests point it at a scratch copy and checksum the real file before and after.
- **A POST is a write even when it looks harmless.** Every `/api/c/<id>/…` POST
  changes a company on disk, and `/api/c/<id>/delete` removes one. Point tests at a
  scratch `companiesDir`; never post to a real one.
- **No paid API keys, ever.** This app calls nothing but the local Herdr CLI.
- Never weaken the image check in `src/image.mjs` — it decides what gets written
  to disk from a browser paste.

## Config, not constants
Every tunable lives in `config.json` (port, poll interval, heartbeat, where files
are kept). `server.mjs` is the only reader (and `scripts/company.mjs`, for the same
file); `ONE_WAY_OUT_CONFIG` may point either at a different copy — that is how tests
run on scratch folders. Nothing else touches the filesystem layout or the environment.
