// Thin transport: serves the UI and the live JSON endpoints. No business logic here.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { resolveHerdrBin, getSnapshot, readPane, runInPane, focusPane, closePane, startAgent, movePane, sendKeys, PANE_KEYS } from './src/herdr.mjs';
import { validateDest, moveArgs, startPlan, moveKept, PLACES } from './src/moves.mjs';
import { PRESETS, applyPreset, toSaved, fromSaved } from './src/org.mjs';
import { startRunPlan, checkRun, approveRun } from './src/crew.mjs';
import { buildModel, listAgents, checkAgreedCount } from './src/model.mjs';
import { sharedFolders } from './src/collisions.mjs';
import { checkStates, boardOf, lanes } from './src/state.mjs';
import { buildBriefs, cleanWires, teamsFromWires, KINDS } from './src/team.mjs';
import { listCommands } from './src/commands.mjs';
import { validateFlow } from './src/flows.mjs';
import { list, save, remove } from './src/store.mjs';
import { isValidPaneId, isValidId } from './src/ids.mjs';
import { listProjects } from './src/projects.mjs';
import { compilePrompts, matchPrompt, panesToScan, groupWaiting } from './src/prompts.mjs';
import { exactLabel } from './public/menu.js';
import { answerMenu } from './src/answer.mjs';
import { readImage, IMAGE_LIMITS } from './src/image.mjs';
import { startRun, listRuns, stopRun } from './src/runner.mjs';
import { reloadConfig } from './src/herdr.mjs';
import { SETTINGS, readSettings, patchSettings } from './src/herdrsettings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const herdrBin = resolveHerdrBin(config.herdrBin);
const flowsDir = config.flowsDir || path.join(os.homedir(), '.claude', 'herdr', 'flows');
// Where a pasted picture is kept so an agent can open it by path.
const shotsDir = config.shotsDir || path.join(os.homedir(), '.claude', 'herdr', 'shots');
// The lines you drew between agents — one record, its own folder so a workflow listing never
// picks it up as a workflow.
const wiresDir = config.wiresDir || path.join(os.homedir(), '.claude', 'herdr', 'wires');
const WIRES_ID = 'connections';
// One folder per run of the org builder: goal.md, plan.json, run.json — see src/crew.mjs.
const runsDir = config.runsDir || path.join(os.homedir(), '.claude', 'herdr', 'runs');
// How many agents may work in one folder before the map says so. They share one set of files,
// so a second agent there can overwrite the first one's work; 1 means two is already worth
// saying. The number itself lives in config.json — this is only where it is read.
const maxPerFolder = config.maxAgentsPerFolder ?? 1;
// The board's columns, in the order that decides which one a card lands in — see src/state.mjs.
// A list that cannot answer is refused here rather than losing a card off the board later.
const states = config.states ?? [];
// How a column earns its width — see lanes() in src/state.mjs.
const boardCfg = {
  cardsPerLane: config.board?.cardsPerLane ?? 4,
  maxLanes: config.board?.maxLanes ?? 3,
  minLaneWidthPx: config.board?.minLaneWidthPx ?? 240,
};
const stateProblems = checkStates(states);
if (stateProblems.length) {
  console.error('config.json states are unusable, the board will be empty:');
  for (const p of stateProblems) console.error('  -', p);
}
const limits = {
  timeoutMs: config.workflow?.stepTimeoutMs ?? 900000,
  settleMs: config.workflow?.settleMs ?? 6000,
  spawnReadyMs: config.workflow?.spawnReadyMs ?? 30000,
  pollMs: config.pollIntervalMs ?? 1500,
  maxConcurrent: config.workflow?.maxConcurrent ?? 3,
};
// Caps for the run/plan/task org builder (src/crew.mjs, src/plan.mjs) — a distinct block from
// the `limits` above, which belongs to the older saved-workflow runner.
const runLimits = {
  maxAgents: config.run?.maxAgents ?? 8,
  maxDepth: config.run?.maxDepth ?? 3,
  plannerRetries: config.run?.plannerRetries ?? 1,
  taskRetries: config.run?.taskRetries ?? 1,
  taskTimeoutMs: config.run?.taskTimeoutMs ?? 1800000,
  runTimeoutMs: config.run?.runTimeoutMs ?? 10800000,
};

// The questions this app can answer for every agent at once. They are written in
// config.json — the wording, the answers offered, and how often to look are all config,
// so a new prompt is a config edit and never a code change.
const promptCfg = {
  scanIntervalMs: config.prompts?.scanIntervalMs ?? 5000,
  maxScan: config.prompts?.maxScan ?? 24,
  skipStatuses: config.prompts?.skipStatuses ?? ['working'],
  settleMs: config.prompts?.settleMs ?? 350,
};
const { prompts: knownPrompts, errors: promptErrors } = compilePrompts(config.prompts?.known);
for (const e of promptErrors) console.error('config.json prompt ignored —', e);

/**
 * Every agent sitting on one of those questions, right now. Read fresh each time: a pane id
 * moves, and answering a question the agent already left would press keys into its next one.
 */
async function scanWaiting() {
  if (!knownPrompts.length) return { ok: true, entries: [] };
  const snap = await getSnapshot(herdrBin);
  if (!snap.ok) return { ok: false, error: snap.error };
  const targets = panesToScan(buildModel(snap.snapshot), promptCfg.skipStatuses, promptCfg.maxScan);
  // Read them together, but keep the map's own order: a list that reshuffles on every poll
  // because one pane answered first is a list nobody can read.
  const found = await Promise.all(targets.map(async (t) => {
    try {
      const prompt = matchPrompt(await readPane(herdrBin, t.id, 'text'), knownPrompts);
      return prompt ? { ...t, prompt } : null;
    } catch { return null; }   // a pane that closed mid-scan is simply not waiting
  }));
  return { ok: true, entries: found.filter(Boolean) };
}

// Ready-made workflows shipped with the app, so the panel is never a blank page.
const presets = JSON.parse(await readFile(path.join(root, 'presets', 'workflows.json'), 'utf8'));

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

/** Read a request body with a hard size cap (trust boundary). */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const ok = (res, data = {}) => send(res, 200, JSON.stringify({ ok: true, ...data }));

/** Did this request come from the page this server serves, rather than from another site? */
const HOME = new Set([`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
const fromThisPage = (req) => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const {origin} = req.headers;
  return !origin || HOME.has(origin);
};
const fail = (res, error, code = 200) => send(res, code, JSON.stringify({ ok: false, error: String(error) }));

/** Parse a JSON POST body, or null if it is missing/too big/malformed. */
async function jsonBody(req, limit) {
  const raw = await readBody(req, limit);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const post = req.method === 'POST';

  // Every POST here reaches a live agent — it types into one, answers one, or closes one. A
  // page open in another tab can post to a local server without asking it first, so the only
  // thing that separates this page from that one is where the request says it came from.
  // Reads are left alone: they change nothing.
  if (post && !fromThisPage(req)) {
    return fail(res, 'That request did not come from this page, so nothing was done.', 403);
  }

  if (url.pathname === '/api/snapshot') {
    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    const model = buildModel(snap.snapshot);
    const cols = boardOf(model, states);
    const wide = lanes(cols, boardCfg);
    return ok(res, {
      model, shared: sharedFolders(model, maxPerFolder),
      board: cols.map((c, i) => ({ ...c, lanes: wide[i] })),
    });
  }

  if (url.pathname === '/api/config') {
    // `states` goes to the browser rather than being written there, so the words on a column and
    // the rule that fills it are the same single edit to config.json.
    return send(res, 200, JSON.stringify({
      pollIntervalMs: config.pollIntervalMs, places: PLACES,
      promptScanMs: promptCfg.scanIntervalMs, states, board: boardCfg,
    }));
  }

  // Herdr's own look-and-feel settings. Only the allow-listed keys in herdrsettings.mjs can change;
  // the first write of each day keeps a .bak copy of the file as it was.
  if (url.pathname === '/api/terminal/settings') {
    const file = config.herdrConfigPath;
    if (!file) return fail(res, 'herdrConfigPath is not set in config.json');
    const text = existsSync(file) ? await readFile(file, 'utf8') : '';
    if (!post) return ok(res, { settings: SETTINGS, values: readSettings(text) });
    const body = await jsonBody(req);
    if (!body || typeof body.changes !== 'object') return fail(res, 'Bad request body', 400);
    let next;
    try { next = patchSettings(text, body.changes); } catch (e) { return fail(res, e.message, 400); }
    const bak = file + '.bak-' + new Date().toISOString().slice(0, 10);
    if (existsSync(file) && !existsSync(bak)) await writeFile(bak, text);
    await writeFile(file, next);
    try {
      const reload = await reloadConfig(herdrBin);
      return ok(res, { values: readSettings(next), diagnostics: reload.diagnostics ?? [] });
    } catch (e) {
      return fail(res, 'Saved, but Herdr did not reload it: ' + e.message);
    }
  }

  // Every slash command / skill this machine can run, for the pane's project.
  if (url.pathname === '/api/commands') {
    return ok(res, { commands: await listCommands(url.searchParams.get('cwd')) });
  }

  // Live screen text for one pane: GET /api/pane/read?id=w1:p1
  if (url.pathname === '/api/pane/read') {
    const id = url.searchParams.get('id');
    if (!isValidPaneId(id)) return fail(res, 'Bad pane id', 400);
    try {
      const format = url.searchParams.get('format') === 'ansi' ? 'ansi' : 'text';
      return ok(res, { text: await readPane(herdrBin, id, format) });
    } catch (e) { return fail(res, e.message || e); }
  }

  // Reply to a pane (text + Enter) or focus it in the Herdr terminal.
  if ((url.pathname === '/api/pane/send' || url.pathname === '/api/pane/focus') && post) {
    const body = await jsonBody(req);
    if (!body) return fail(res, 'Bad request body', 400);
    if (!isValidPaneId(body.id)) return fail(res, 'Bad pane id', 400);
    try {
      if (url.pathname === '/api/pane/focus') await focusPane(herdrBin, body.id);
      else await runInPane(herdrBin, body.id, typeof body.text === 'string' ? body.text.slice(0, 4000) : '');
      return ok(res);
    } catch (e) { return fail(res, e.message || e); }
  }

  /* Keep an image so an agent can read it: {dataUrl} in, an absolute path out.
     Agents read files, not clipboards, so a pasted picture has to become a real file first.
     The bytes decide what it is, the name is the hash of those bytes, and the path never
     comes from anything the page said — so nothing here can be steered into writing
     somewhere else or serving something back that was not an image. */
  if (url.pathname === '/api/pane/image' && post) {
    const body = await jsonBody(req, IMAGE_LIMITS.bytes * 1.4);
    if (!body) return fail(res, 'That image is too big to send.', 400);
    const file = readImage(body.dataUrl);
    if (!file.ok) return fail(res, file.error);
    const name = `${createHash('sha1').update(file.buffer).digest('hex').slice(0, 24)}.${file.ext}`;
    try {
      await mkdir(shotsDir, { recursive: true });
      const full = path.join(shotsDir, name);
      await writeFile(full, file.buffer);
      return ok(res, { path: full, src: `data:image/${file.ext};base64,${file.buffer.toString('base64')}` });
    } catch (e) { console.error('image write failed:', e); return fail(res, 'Could not keep that image.'); }
  }

  // Press allow-listed keys in a pane, in order: {id, key} or {id, keys:[...]}.
  // The allow-list lives in src/herdr.mjs; a bad name fails the whole request, so half a
  // key sequence never lands on a live agent.
  if (url.pathname === '/api/pane/keys' && post) {
    const body = await jsonBody(req);
    if (!body) return fail(res, 'Bad request body', 400);
    if (!isValidPaneId(body.id)) return fail(res, 'Bad pane id', 400);
    // Clicking a menu row sends its WORDS, not its number. The highlight wraps and moves
    // as the keys land, so the row it is on can only be learned by looking — src/answer.mjs.
    if (typeof body.choice === 'string') {
      const label = body.choice.trim().slice(0, 200);
      if (!label) return fail(res, 'That is not a menu option', 400);
      const walked = await answerMenu(herdrBin, body.id, exactLabel(label), { settleMs: promptCfg.settleMs });
      return walked.ok ? ok(res, { label: walked.label, presses: walked.presses }) : fail(res, walked.error);
    }
    const keys = Array.isArray(body.keys) ? body.keys : [body.key];
    if (!keys.length || keys.length > 40) return fail(res, 'Bad key request', 400);
    if (!keys.every((k) => typeof k === 'string' && k in PANE_KEYS)) return fail(res, 'That key is not allowed', 400);
    try {
      for (const k of keys) await sendKeys(herdrBin, body.id, k);
      return ok(res);
    } catch (e) { return fail(res, e.message || e); }
  }

  // Every agent stopped on a question this app knows how to answer, grouped by question.
  if (url.pathname === '/api/prompts' && !post) {
    const scan = await scanWaiting();
    if (!scan.ok) return fail(res, scan.error);
    return ok(res, { waiting: groupWaiting(scan.entries) });
  }

  // Answer one of those questions the same way for every agent on it: {promptId, choiceId}.
  // The scan is redone here rather than trusting what the page last saw, and each agent is
  // walked to ITS OWN row — the same answer can be option 1 on one screen and 2 on another.
  if (url.pathname === '/api/prompts/answer' && post) {
    const body = await jsonBody(req);
    if (!body) return fail(res, 'Bad request body', 400);
    const scan = await scanWaiting();
    if (!scan.ok) return fail(res, scan.error);
    const targets = scan.entries
      .filter((e) => e.prompt.id === body.promptId)
      .map((e) => ({ id: e.id, label: e.label, choice: e.prompt.choices.find((c) => c.id === body.choiceId) }))
      .filter((t) => t.choice && isValidPaneId(t.id));
    if (!targets.length) return fail(res, 'No agent is waiting on that any more.');
    // The bar's counts come from a scan on its own slower clock, which stops entirely while the
    // tab is hidden — so the number confirmed can be minutes old, and agents that arrived on the
    // question since would be typed into without ever having been named.
    const agreed = checkAgreedCount(targets.length, body.expect,
      { did: 'answered', state: 'waiting on that', button: 'the answer' });
    if (!agreed.ok) return fail(res, agreed.error);
    // Each agent is walked on its own screen, and the answer is found by its words every
    // time — the same answer sits on a different row on different agents, and that row
    // moves as the keys land.
    const walked = await Promise.all(targets.map(async (t) => {
      const r = await answerMenu(herdrBin, t.id, new RegExp(t.choice.match, 'i'), { settleMs: promptCfg.settleMs });
      if (!r.ok) console.error(`prompt answer failed for ${t.label ?? t.id}: ${r.error}`);
      return { who: t.label ?? t.id, ...r };
    }));
    const answered = walked.filter((r) => r.ok).length;
    // Name the ones that did not take. A half-answered fleet reported as done is worse
    // than one reported as failed, because nobody goes back to look.
    const stuck = walked.filter((r) => !r.ok).map((r) => `${r.who}: ${r.error}`);
    return ok(res, { answered, failed: stuck.length, stuck });
  }

  // Shut every agent down — the whole map, or one workspace: {workspaceId?}.
  if (url.pathname === '/api/agents/close-all' && post) {
    const body = await jsonBody(req);
    if (!body) return fail(res, 'Bad request body', 400);
    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    const ids = listAgents(buildModel(snap.snapshot), body.workspaceId || null)
      .map((a) => a.id).filter(isValidPaneId);
    const agreed = checkAgreedCount(ids.length, body.expect);
    if (!agreed.ok) return fail(res, agreed.error);
    const results = await Promise.all(ids.map((id) => closePane(herdrBin, id).then(() => true, () => false)));
    const closed = results.filter(Boolean).length;
    return ok(res, { closed, failed: ids.length - closed });
  }

  // Folders you could start an agent in — running ones first.
  if (url.pathname === '/api/projects') {
    const snap = await getSnapshot(herdrBin);
    const inUse = snap.ok ? listAgents(buildModel(snap.snapshot)).map((a) => a.cwd) : [];
    return ok(res, { projects: await listProjects(config.projectRoots ?? [], inUse) });
  }

  // Start a new agent in a folder: {cwd, label?, command?, dest?}.
  // `dest` says where it lands — see src/moves.mjs. Left out, it gets a window of its own,
  // which is the only destination that can never squeeze an existing agent.
  if (url.pathname === '/api/agents/start' && post) {
    const body = await jsonBody(req);
    const cwd = String(body?.cwd ?? '').trim();
    if (!cwd || !path.isAbsolute(cwd)) return fail(res, 'Pick a folder first.', 400);
    const command = (String(body?.command ?? '').trim() || config.defaultAgentCommand || 'claude').slice(0, 200);
    const label = (String(body?.label ?? '').trim() || path.basename(cwd)).slice(0, 40);
    const checked = validateDest(body?.dest ?? { type: 'new_workspace' });
    if (!checked.ok) return fail(res, checked.error, 400);
    const plan = startPlan(checked.dest);
    try {
      const paneId = await startAgent(herdrBin, { label, cwd, ...plan.start, argv: command.split(/\s+/) });
      if (!plan.then) return ok(res, { paneId, label });
      // Two steps, because Herdr can only start a pane beside one that already exists. If the
      // move fails the agent is alive and usable, just not where it was asked to go — say so.
      try {
        await movePane(herdrBin, moveArgs(paneId, plan.then));
        return ok(res, { paneId, label });
      } catch (e) {
        console.error('agent placed, move failed:', e);
        return ok(res, { paneId, label, warning: 'It started, but Herdr would not put it where you asked.' });
      }
    } catch (e) {
      console.error('agent start failed:', e);
      return fail(res, 'Herdr could not start an agent there. Check the folder still exists.');
    }
  }

  // Move one running agent somewhere else: {id, dest}. The agent keeps its conversation.
  if (url.pathname === '/api/pane/move' && post) {
    const body = await jsonBody(req);
    if (!isValidPaneId(body?.id)) return fail(res, 'That is not an agent Herdr knows.', 400);
    const checked = validateDest(body?.dest);
    if (!checked.ok) return fail(res, checked.error, 400);
    const find = async (id) => {
      const s = await getSnapshot(herdrBin);
      return s.ok ? (s.snapshot.panes ?? []).find((p) => p.pane_id === id) ?? null : null;
    };
    const before = await find(body.id);
    if (!before) return fail(res, 'That agent is no longer running.', 404);
    try {
      const moved = await movePane(herdrBin, moveArgs(body.id, checked.dest));
      const now = moved.pane?.pane_id ?? body.id;
      const kept = moveKept(
        { terminalId: before.terminal_id },
        await find(now).then((p) => (p ? { terminalId: p.terminal_id } : null)),
      );
      if (!kept.ok) return fail(res, kept.error);
      return ok(res, { paneId: now, closedWorkspaceId: moved.closed_workspace_id ?? null });
    } catch (e) {
      console.error('pane move failed:', e);
      return fail(res, 'Herdr would not move that agent.');
    }
  }

  // The three meanings a line between agents can have — the words live in src/team.mjs.
  if (url.pathname === '/api/kinds' && !post) {
    return ok(res, { kinds: KINDS });
  }

  // ── The lines you drew, kept ──
  // Written against each agent's conversation id, not its pane id, so a line survives both a
  // move and a restart of this app. A line whose agent is gone is simply not returned.
  if (url.pathname === '/api/wires') {
    const snap = await getSnapshot(herdrBin);
    const agents = snap.ok ? listAgents(buildModel(snap.snapshot)) : [];
    // The number of groups goes back with the lines. The browser used to work it out again from
    // its own copy of the rule and the two did not agree — measured 2026-09-02, "side by side"
    // then "colleagues" over three agents was two jobs to the server and one group on screen.
    // Grouping belongs to src/team.mjs, so it is counted there and only there.
    if (!post) {
      const saved = (await list(wiresDir)).find((r) => r.id === WIRES_ID)?.wires ?? [];
      const wires = cleanWires(fromSaved(saved, agents));
      return ok(res, { wires, groups: teamsFromWires(wires).length });
    }
    const drawn = cleanWires((await jsonBody(req, 256 * 1024))?.wires);
    await save(wiresDir, { id: WIRES_ID, name: 'connections', wires: toSaved(drawn, agents) });
    return ok(res, { saved: drawn.length, groups: teamsFromWires(drawn).length });
  }

  // ── Ready-made shapes for the chain of command ──
  if (url.pathname === '/api/org/presets' && !post) {
    return ok(res, { presets: PRESETS });
  }

  // Apply one shape to the agents running now: {id, agentIds?}. It replaces every line and is
  // saved in the same breath, so one click is the whole action — and every line it made can
  // then be changed or removed by hand like any other.
  if (url.pathname === '/api/org/preset' && post) {
    const body = await jsonBody(req);
    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    const agents = listAgents(buildModel(snap.snapshot));
    const known = new Set(agents.map((a) => a.id));
    const ids = Array.isArray(body?.agentIds) && body.agentIds.length
      ? body.agentIds.filter((id) => known.has(id))
      : agents.map((a) => a.id);
    const drawn = cleanWires(applyPreset(String(body?.id ?? ''), ids));
    await save(wiresDir, { id: WIRES_ID, name: 'connections', wires: toSaved(drawn, agents) });
    return ok(res, { wires: drawn, agents: ids.length });
  }

  // ── A run: one goal, split by a planner agent into a plan you approve before anything else starts ──
  // POST body: {goal, folder}. Starts a planner in `folder` and returns the new run's id.
  if (url.pathname === '/api/run/plan' && post) {
    const body = await jsonBody(req);
    const goal = String(body?.goal ?? '').trim().slice(0, 2000);
    const folder = String(body?.folder ?? '').trim();
    if (!goal) return fail(res, 'Type the goal first.', 400);
    if (!folder || !path.isAbsolute(folder)) return fail(res, 'Pick a folder first.', 400);
    try {
      const id = await startRunPlan(herdrBin, runsDir, { goal, folder });
      return ok(res, { id });
    } catch (e) {
      console.error('run plan failed:', e);
      return fail(res, 'Herdr could not start the planner. Check the folder still exists.');
    }
  }

  // Where a run's plan stands: GET /api/run/status?id=run-xxxx
  if (url.pathname === '/api/run/status' && !post) {
    const id = url.searchParams.get('id') ?? '';
    const checked = await checkRun(herdrBin, runsDir, id, runLimits);
    if (!checked.ok) return fail(res, checked.error, 404);
    return ok(res, { run: checked.run });
  }

  // Start the org this run's plan describes: {id, plan}. `plan` came back from an editable
  // screen, so it is re-checked here before a single agent is spawned.
  if (url.pathname === '/api/run/approve' && post) {
    const body = await jsonBody(req, 512 * 1024);
    const checked = await approveRun(herdrBin, runsDir, { id: String(body?.id ?? ''), plan: body?.plan }, runLimits);
    if (!checked.ok) return fail(res, checked.error);
    return ok(res, { run: checked.run });
  }

  // Pick a run back up after this server restarted: {id}. There is no in-memory run state to
  // lose — checkRun already rebuilds everything from run.json plus which result files exist on
  // every call — so this is that same recompute, run once on request rather than waited for on
  // the next poll. A task whose pane went idle without writing while nothing was watching gets
  // its usual retry-then-escalate right here, and report.md is written once every top task lands.
  if (url.pathname === '/api/run/resume' && post) {
    const body = await jsonBody(req);
    const checked = await checkRun(herdrBin, runsDir, String(body?.id ?? ''), runLimits);
    if (!checked.ok) return fail(res, checked.error, 404);
    return ok(res, { run: checked.run });
  }

  // ── The lines drawn on the map: give every joined-up group the same job, each its own part ──
  if (url.pathname === '/api/connections/dispatch' && post) {
    const body = await jsonBody(req, 512 * 1024);
    const task = String(body?.task ?? '').trim();
    if (!task) return fail(res, 'Type the job for these agents.', 400);

    const groups = teamsFromWires(cleanWires(body?.wires));
    if (!groups.length) return fail(res, 'Draw a line between two agents first — that is what says who works with whom.');

    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    const byId = new Map(listAgents(buildModel(snap.snapshot)).map((a) => [a.id, a]));

    const briefs = groups.flatMap((g) => buildBriefs({
      bin: herdrBin,
      kind: g.kind,
      leader: g.leaderId ? byId.get(g.leaderId) : null,
      members: g.memberIds.map((id) => byId.get(id)).filter(Boolean),
      task,
    }));
    const gone = groups.flatMap((g) => [g.leaderId, ...g.memberIds]).filter((id) => id && !byId.has(id));
    if (!briefs.length) return fail(res, 'None of the connected agents are still running.');

    const results = await Promise.all(briefs.map((b) =>
      runInPane(herdrBin, b.paneId, b.text).then(() => true, (e) => { console.error('connection dispatch failed:', e); return false; })));
    const sent = results.filter(Boolean).length;
    if (!sent) return fail(res, 'Herdr would not take the message. Open an agent and check it is at a prompt.');
    return ok(res, { sent, failed: briefs.length - sent, gone: [...new Set(gone)].length });
  }

  // ── Workflows: saved chains of agent steps, plus the ready-made ones ──
  if (url.pathname === '/api/flows' && !post) {
    return ok(res, { flows: await list(flowsDir), presets });
  }

  if (url.pathname === '/api/flows/save' && post) {
    const check = validateFlow(await jsonBody(req));
    if (!check.ok) return fail(res, check.error);
    try { return ok(res, { flow: await save(flowsDir, check.flow) }); }
    catch (e) { console.error('flow save failed:', e); return fail(res, 'Could not save that workflow.'); }
  }

  if (url.pathname === '/api/flows/delete' && post) {
    const body = await jsonBody(req);
    if (!isValidId(body?.id)) return fail(res, 'Bad workflow id', 400);
    try { await remove(flowsDir, body.id); return ok(res); }
    catch (e) { console.error('flow delete failed:', e); return fail(res, 'Could not delete that workflow.'); }
  }

  if (url.pathname === '/api/flows/run' && post) {
    const check = validateFlow(await jsonBody(req));
    if (!check.ok) return fail(res, check.error);
    try { return ok(res, { run: startRun(herdrBin, check.flow, limits) }); }
    catch (e) { return fail(res, e.message || e); }
  }

  if (url.pathname === '/api/flows/runs' && !post) {
    return ok(res, { runs: listRuns() });
  }

  if (url.pathname === '/api/flows/stop' && post) {
    const body = await jsonBody(req);
    return ok(res, { stopped: stopRun(String(body?.id ?? '')) });
  }

  // Static files from /public (index.html by default).
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(root, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) {
    return send(res, 404, 'Not found', 'text/plain');
  }
  const body = await readFile(file);
  send(res, 200, body, MIME[path.extname(file)] || 'application/octet-stream');
});

const target = `http://localhost:${config.port}`;
function openBrowser() {
  if (!config.openBrowser) return;
  const cmd = process.platform === 'win32' ? `start "" "${target}"`
    : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(cmd, { windowsHide: true });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Already running — just surface the existing map instead of crashing.
    console.log(`One-Way-Out already running at ${target} — opening it.`);
    openBrowser();
    process.exit(0);
  }
  throw e;
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`One-Way-Out running at ${target}`);
  console.log(`Using Herdr at: ${herdrBin}`);
  console.log(`Workflows saved in: ${flowsDir}`);
  openBrowser();
});
