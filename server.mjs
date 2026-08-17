// Thin transport: serves the UI and the live JSON endpoints. No business logic here.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { resolveHerdrBin, getSnapshot, readPane, runInPane, focusPane, closePane, startAgent, sendKeys, PANE_KEYS } from './src/herdr.mjs';
import { buildModel, listAgents } from './src/model.mjs';
import { buildBriefs, cleanWires, teamsFromWires, KINDS } from './src/team.mjs';
import { listCommands } from './src/commands.mjs';
import { validateFlow } from './src/flows.mjs';
import { list, save, remove } from './src/store.mjs';
import { isValidPaneId, isValidId } from './src/ids.mjs';
import { listProjects } from './src/projects.mjs';
import { readImage, IMAGE_LIMITS } from './src/image.mjs';
import { startRun, listRuns, stopRun } from './src/runner.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const herdrBin = resolveHerdrBin(config.herdrBin);
const flowsDir = config.flowsDir || path.join(os.homedir(), '.claude', 'herdr-flows');
// Where a pasted picture is kept so an agent can open it by path.
const shotsDir = config.shotsDir || path.join(os.homedir(), '.claude', 'herdr-shots');
const limits = {
  timeoutMs: config.workflow?.stepTimeoutMs ?? 900000,
  settleMs: config.workflow?.settleMs ?? 6000,
  spawnReadyMs: config.workflow?.spawnReadyMs ?? 30000,
  pollMs: config.pollIntervalMs ?? 1500,
  maxConcurrent: config.workflow?.maxConcurrent ?? 3,
};

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

  if (url.pathname === '/api/snapshot') {
    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    return ok(res, { model: buildModel(snap.snapshot) });
  }

  if (url.pathname === '/api/config') {
    return send(res, 200, JSON.stringify({ pollIntervalMs: config.pollIntervalMs }));
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
    const keys = Array.isArray(body.keys) ? body.keys : [body.key];
    if (!keys.length || keys.length > 40) return fail(res, 'Bad key request', 400);
    if (!keys.every((k) => typeof k === 'string' && k in PANE_KEYS)) return fail(res, 'That key is not allowed', 400);
    try {
      for (const k of keys) await sendKeys(herdrBin, body.id, k);
      return ok(res);
    } catch (e) { return fail(res, e.message || e); }
  }

  // Shut every agent down — the whole map, or one workspace: {workspaceId?}.
  if (url.pathname === '/api/agents/close-all' && post) {
    const body = await jsonBody(req);
    if (!body) return fail(res, 'Bad request body', 400);
    const snap = await getSnapshot(herdrBin);
    if (!snap.ok) return fail(res, snap.error);
    const ids = listAgents(buildModel(snap.snapshot), body.workspaceId || null)
      .map((a) => a.id).filter(isValidPaneId);
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

  // Start a new agent in a folder: {cwd, label?, command?}.
  if (url.pathname === '/api/agents/start' && post) {
    const body = await jsonBody(req);
    const cwd = String(body?.cwd ?? '').trim();
    if (!cwd || !path.isAbsolute(cwd)) return fail(res, 'Pick a folder first.', 400);
    const command = (String(body?.command ?? '').trim() || config.defaultAgentCommand || 'claude').slice(0, 200);
    const label = (String(body?.label ?? '').trim() || path.basename(cwd)).slice(0, 40);
    try {
      const paneId = await startAgent(herdrBin, {
        label, cwd, workspaceId: '', split: 'right', argv: command.split(/\s+/),
      });
      return ok(res, { paneId, label });
    } catch (e) {
      console.error('agent start failed:', e);
      return fail(res, 'Herdr could not start an agent there. Check the folder still exists.');
    }
  }

  // The three meanings a line between agents can have — the words live in src/team.mjs.
  if (url.pathname === '/api/kinds' && !post) {
    return ok(res, { kinds: KINDS });
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
    console.log(`Herdr Map already running at ${target} — opening it.`);
    openBrowser();
    process.exit(0);
  }
  throw e;
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Herdr Map running at ${target}`);
  console.log(`Using Herdr at: ${herdrBin}`);
  console.log(`Workflows saved in: ${flowsDir}`);
  openBrowser();
});
