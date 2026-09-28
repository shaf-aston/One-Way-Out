// Service layer: where a company lives on disk, and the one way to change it.
//
//   <companiesDir>/<id>/company.json    the company itself
//                       goals.json  employees.json  issues.json  routines.json  approvals.json
//                       activity.jsonl  append-only log, one JSON line per event
//                       work/<issue>.md             an agent's result — the only proof it finished
//                       work/<issue>.delegate.json  issues (and hires) an agent handed out
//
// Everything is read fresh on every call, so a restart of this app loses nothing: a company is
// a folder, not a process. Every change goes through `withCompany`, which runs one change per
// company at a time — the heartbeat and a click on the page can never write over each other.
import { readdir, readFile, writeFile, mkdir, rename, appendFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isValidId } from './ids.mjs';

const PARTS = ['goals', 'employees', 'issues', 'routines', 'approvals'];
const MAX_ACTIVITY_READ = 4000;

const dirOf = (root, id) => {
  if (!isValidId(id)) throw new Error('That is not a company this app knows.');
  return path.join(root, id);
};

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

/** Write through a temporary file, so a crash mid-write never leaves half a file behind. */
async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

/** Every company, by name. */
export async function listCompanies(root) {
  let names = [];
  try { names = await readdir(root); } catch { return []; }
  const all = await Promise.all(names.filter(isValidId).map((n) => readJson(path.join(root, n, 'company.json'), null)));
  return all.filter((c) => c?.id).sort((a, b) => a.name.localeCompare(b.name));
}

/** One company and everything in it, or null. */
export async function loadState(root, id) {
  const dir = dirOf(root, id);
  const company = await readJson(path.join(dir, 'company.json'), null);
  if (!company) return null;
  const parts = await Promise.all(PARTS.map((p) => readJson(path.join(dir, `${p}.json`), [])));
  return { company, ...Object.fromEntries(PARTS.map((p, i) => [p, Array.isArray(parts[i]) ? parts[i] : []])) };
}

export async function saveState(root, state) {
  const dir = dirOf(root, state.company.id);
  await writeJson(path.join(dir, 'company.json'), state.company);
  await Promise.all(PARTS.map((p) => writeJson(path.join(dir, `${p}.json`), state[p] ?? [])));
}

export async function deleteCompany(root, id) {
  await rm(dirOf(root, id), { recursive: true, force: true });
}

export async function appendActivity(root, id, lines = []) {
  if (!lines.length) return;
  const file = path.join(dirOf(root, id), 'activity.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

/** The newest lines of the log, oldest first. */
export async function readActivity(root, id) {
  const raw = await readFile(path.join(dirOf(root, id), 'activity.jsonl'), 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).slice(-MAX_ACTIVITY_READ)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/* ── One change at a time, per company ── */
const queues = new Map();

/**
 * Run `fn(state)` with nothing else changing this company meanwhile. Whatever `fn` returns as
 * `state` is saved, and its `log` lines appended; `result` is handed back to the caller.
 * @param {(state:object) => Promise<{state?:object, log?:object[], result?:any}>|{state?:object, log?:object[], result?:any}} fn
 */
export function withCompany(root, id, fn) {
  const before = queues.get(id) ?? Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    const state = await loadState(root, id);
    if (!state) throw new Error('That company does not exist.');
    const out = (await fn(state)) ?? {};
    if (out.state) await saveState(root, out.state);
    if (out.log?.length) await appendActivity(root, id, out.log);
    return out.result;
  });
  queues.set(id, run.finally(() => { if (queues.get(id) === run) queues.delete(id); }));
  return run;
}

/* ── The work folder: what agents write back ── */
export function workPaths(root, id) {
  const work = path.join(dirOf(root, id), 'work');
  return {
    dir: work,
    result: (issueId) => path.join(work, `${issueId}.md`),
    delegate: (issueId) => path.join(work, `${issueId}.delegate.json`),
  };
}

/** Which issues have a result file, and what each delegation file says. */
export async function scanWork(root, id) {
  const { dir } = workPaths(root, id);
  let files = [];
  try { files = await readdir(dir); } catch { return { results: new Set(), delegations: new Map() }; }
  const results = new Set(files.filter((f) => /^[a-z0-9-]+\.md$/.test(f)).map((f) => f.slice(0, -3)));
  const delegations = new Map();
  for (const f of files.filter((x) => /^[a-z0-9-]+\.delegate\.json$/.test(x))) {
    const issueId = f.slice(0, -'.delegate.json'.length);
    const raw = await readFile(path.join(dir, f), 'utf8').catch(() => null);
    try { delegations.set(issueId, JSON.parse(raw)); } catch (e) {
      delegations.set(issueId, { error: `That is not valid JSON: ${String(e.message || e).slice(0, 200)}` });
    }
  }
  return { results, delegations };
}

/** Put a work file aside with a date on it, so it is kept but no longer counts. */
export async function retireWork(file, now = Date.now()) {
  await rename(file, `${file}.${now}.old`).catch(() => {});
}

/** An agent's result, for the issue page. */
export async function readResult(root, id, issueId) {
  if (!isValidId(issueId)) return null;
  const file = workPaths(root, id).result(issueId);
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  return { text: (await readFile(file, 'utf8')).slice(0, 64 * 1024), at: info.mtimeMs };
}
