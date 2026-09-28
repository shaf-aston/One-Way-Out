// Thin transport: serves the UI and the live JSON endpoints. No business logic here.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { resolveHerdrBin, getSnapshot, readPane, runInPane, focusPane, closePane, startAgent, movePane, sendKeys, reloadConfig, PANE_KEYS } from './src/herdr.mjs';
import { validateDest, moveArgs, startPlan, moveKept, PLACES } from './src/moves.mjs';
import { buildModel, listAgents, checkAgreedCount } from './src/model.mjs';
import { sharedFolders } from './src/collisions.mjs';
import { checkStates, boardOf, lanes } from './src/state.mjs';
import { listCommands } from './src/commands.mjs';
import { isValidPaneId, isValidId } from './src/ids.mjs';
import { listProjects } from './src/projects.mjs';
import { compilePrompts, matchPrompt, panesToScan, groupWaiting } from './src/prompts.mjs';
import { exactLabel } from './public/menu.js';
import { answerMenu } from './src/answer.mjs';
import { readImage, IMAGE_LIMITS } from './src/image.mjs';
import { SETTINGS, readSettings, patchSettings } from './src/herdrsettings.mjs';
import { validateCompany, patchCompany, validateEmployee, validateGoal, validateRoutine, exportBundle, importBundle, text, MODELS, EMPLOYEE_STATES } from './src/company.mjs';
import { validateIssue, issueKey, STATUSES, PRIORITIES, lanesClash } from './src/issues.mjs';
import { budgetBars, overBudget } from './src/budget.mjs';
import { describeSchedule } from './src/schedule.mjs';
import { applyApproval, DEFAULT_LIMITS } from './src/heartbeat.mjs';
import { entry, filterActivity } from './src/activity.mjs';
import { TEMPLATES } from './src/templates.mjs';
import { listCompanies, loadState, saveState, withCompany, readActivity, appendActivity, readResult, workPaths, retireWork, deleteCompany } from './src/companies.mjs';
import { createOffice, matchPanes, unhired } from './src/office.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// A test run points this at a scratch copy, so it never touches your real companies or Herdr.
const config = JSON.parse(await readFile(process.env.ONE_WAY_OUT_CONFIG || path.join(root, 'config.json'), 'utf8'));
const herdrBin = resolveHerdrBin(config.herdrBin);
const home = (...p) => path.join(os.homedir(), '.claude', 'herdr', ...p);
// Where a pasted picture is kept so an agent can open it by path.
const shotsDir = config.shotsDir || home('shots');
// One folder per company — see src/companies.mjs for what is inside.
const companiesDir = config.companiesDir || home('companies');
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
// The heartbeat's numbers — see src/heartbeat.mjs for what each one governs.
const beat = { ...DEFAULT_LIMITS, deliverWaitMs: 2000, enabled: true, ...(config.heartbeat ?? {}) };
const office = createOffice({ bin: herdrBin, root: companiesDir, limits: beat, agentCommand: config.defaultAgentCommand || 'claude' });

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

/* ── Herdr's snapshot, shared ──
   The map, every company page and the heartbeat all ask "what is running?" within the same
   second. One answer is kept for a moment and handed to all of them, rather than each one
   running the Herdr CLI again. */
let snapCache = { at: 0, promise: null };
function freshSnapshot(maxAgeMs = 700) {
  if (!snapCache.promise || Date.now() - snapCache.at > maxAgeMs) {
    snapCache = { at: Date.now(), promise: getSnapshot(herdrBin) };
  }
  return snapCache.promise;
}

/* ── Companies ──
   A company is a folder (src/companies.mjs); what it may contain is checked in src/company.mjs
   and src/issues.mjs; what happens next is decided in src/heartbeat.mjs. These handlers only
   read the request, call those, and answer. After anything that could hand out work, the
   heartbeat runs once straight away, so nothing waits for the next tick to start. */
const soon = (cid) => { setTimeout(() => office.tick(cid).catch((e) => console.error('tick failed:', e)), 50); };

async function companiesRoute(req, res, url, post) {
  if (url.pathname === '/api/companies' && !post) {
    return ok(res, { companies: await listCompanies(companiesDir), templates: TEMPLATES });
  }
  if (url.pathname === '/api/companies' && post) {
    const body = await jsonBody(req);
    const taken = (await listCompanies(companiesDir)).map((c) => c.id);
    const made = validateCompany(body, taken);
    if (!made.ok) return fail(res, made.error, 400);
    const employees = [];
    const tpl = TEMPLATES.find((t) => t.id === body?.template) ?? TEMPLATES[0];
    for (const m of tpl.team) {
      const v = validateEmployee(m, employees);
      if (v.ok) employees.push(v.employee);
    }
    const now = Date.now();
    const state = { company: { ...made.company, createdAt: now }, goals: [], employees, issues: [], routines: [], approvals: [] };
    await saveState(companiesDir, state);
    await appendActivity(companiesDir, state.company.id, [entry('you', 'founded', { type: 'company', id: state.company.id },
      `${state.company.name} founded with ${employees.map((e) => e.name).join(', ') || 'nobody yet'}.`, now)]);
    return ok(res, { company: state.company });
  }
  if (url.pathname === '/api/companies/import' && post) {
    const body = await jsonBody(req, 4 * 1024 * 1024);
    const taken = (await listCompanies(companiesDir)).map((c) => c.id);
    const got = importBundle(body?.bundle, taken);
    if (!got.ok) return fail(res, got.error, 400);
    const ctx = { company: got.company, issues: [], employees: got.employees, goals: got.goals };
    for (const raw of got.rawIssues) {
      const v = validateIssue({ ...raw, parentId: null, blockedBy: [] }, ctx,
        { id: isValidId(raw?.id) && !ctx.issues.some((i) => i.id === raw.id) ? raw.id : undefined, number: Number.isInteger(raw?.number) ? raw.number : undefined,
          createdAt: Number(raw?.createdAt) || Date.now(), createdBy: text(raw?.createdBy, 49) || 'you', kind: raw?.kind === 'plan' ? 'plan' : 'work',
          comments: (Array.isArray(raw?.comments) ? raw.comments : []).slice(-200).map((c) => ({ by: text(c?.by, 49), at: Number(c?.at) || 0, text: text(c?.text, 4000) })) });
      if (v.ok) { ctx.issues.push(v.issue); ctx.company.nextIssue = Math.max(ctx.company.nextIssue, v.issue.number + 1); }
    }
    for (const raw of got.rawIssues) {
      const i = ctx.issues.find((x) => x.id === raw?.id);
      if (!i) continue;
      if (ctx.issues.some((x) => x.id === raw.parentId && x.id !== i.id)) i.parentId = raw.parentId;
      i.blockedBy = (Array.isArray(raw.blockedBy) ? raw.blockedBy : []).filter((b) => b !== i.id && ctx.issues.some((x) => x.id === b));
    }
    const state = { company: got.company, goals: got.goals, employees: got.employees, issues: ctx.issues, routines: got.routines, approvals: [] };
    await saveState(companiesDir, state);
    await appendActivity(companiesDir, state.company.id, [entry('you', 'imported', { type: 'company', id: state.company.id }, `${state.company.name} imported.`)]);
    return ok(res, { company: state.company });
  }
  return fail(res, 'Not found', 404);
}

/** Everything the company pages draw, in one read — so a page polls one thing, not six. */
async function companyView(cid) {
  const state = await loadState(companiesDir, cid);
  if (!state) return null;
  const snap = await freshSnapshot();
  const model = snap.ok ? buildModel(snap.snapshot) : null;
  const { panes } = model ? matchPanes(model, state.employees) : { panes: {} };
  const activity = filterActivity(await readActivity(companiesDir, cid), { limit: 80 });
  const now = Date.now();
  return {
    ...state,
    // What each budget bar shows, and the words for everything the pages offer — worked out
    // here, once, so the page never keeps a second copy of a rule.
    employees: state.employees.map((e) => ({ ...e, bars: budgetBars(e, now), over: overBudget(e, now)?.words ?? null })),
    routines: state.routines.map((r) => ({ ...r, when: describeSchedule(r.schedule) })),
    clashes: lanesClash(state.issues),
    vocab: { statuses: STATUSES, priorities: PRIORITIES, models: MODELS, employeeStates: EMPLOYEE_STATES },
    tickMs: beat.tickMs,
    live: Object.fromEntries(Object.entries(panes).map(([id, p]) => [id, p ? { paneId: p.paneId, status: p.status } : null])),
    herdr: snap.ok ? 'ok' : snap.error,
    unhired: model ? unhired(model, state.employees) : [],
    activity,
  };
}

/** Run `change(state, body)` under the company lock; it returns {error} or {log?, wake?, after?, …result}. */
async function mutate(res, cid, body, change) {
  try {
    const out = await withCompany(companiesDir, cid, async (state) => {
      const r = (await change(state, body)) ?? {};
      if (r.error) return { result: r };
      return { state, log: r.log ?? [], result: r };
    });
    const { error, wake, after, log, ...data } = out ?? {};
    if (error) return fail(res, error, 400);
    if (wake) soon(cid);
    if (after) await after();
    return ok(res, data);
  } catch (e) {
    return fail(res, e.message || e, 404);
  }
}

/** Replace the record with the same id in `list`, or add it. */
const upsert = (list, rec) => {
  const i = list.findIndex((x) => x.id === rec.id);
  if (i < 0) list.push(rec); else list[i] = rec;
};

async function companyRoute(req, res, cid, action, url, post) {
  if (!isValidId(cid)) return fail(res, 'Bad company id', 400);
  const now = Date.now();

  if (!post) {
    if (action === 'state') {
      const view = await companyView(cid);
      return view ? ok(res, view) : fail(res, 'That company does not exist.', 404);
    }
    if (action === 'issue') {
      const state = await loadState(companiesDir, cid);
      const issue = state?.issues.find((i) => i.id === url.searchParams.get('id'));
      if (!issue) return fail(res, 'That issue does not exist.', 404);
      return ok(res, {
        issue,
        result: await readResult(companiesDir, cid, issue.id),
        activity: filterActivity(await readActivity(companiesDir, cid), { type: 'issue', id: issue.id, limit: 50 }),
      });
    }
    if (action === 'activity') {
      const q = url.searchParams;
      return ok(res, { activity: filterActivity(await readActivity(companiesDir, cid),
        { actor: q.get('actor') || undefined, type: q.get('type') || undefined, q: q.get('q') || undefined, limit: 500 }) });
    }
    if (action === 'export') {
      const state = await loadState(companiesDir, cid);
      if (!state) return fail(res, 'That company does not exist.', 404);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${cid}.company.json"`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(exportBundle(state), null, 2));
    }
    return fail(res, 'Not found', 404);
  }

  const body = await jsonBody(req, 512 * 1024);
  if (!body) return fail(res, 'Bad request body', 400);

  switch (action) {
    // ── The company itself ──
    case 'company': return mutate(res, cid, body, (s) => {
      const was = s.company.running;
      s.company = patchCompany(s.company, body);
      if (was === s.company.running) return { log: [entry('you', 'edited', { type: 'company', id: cid }, 'Company settings changed.', now)] };
      return { wake: s.company.running, log: [entry('you', s.company.running ? 'started' : 'paused', { type: 'company', id: cid },
        s.company.running ? 'The company is running: employees pick up work on their heartbeat.' : 'The company is paused: nobody is given new work.', now)] };
    });
    case 'delete':
      if (body.confirm !== cid) return fail(res, 'Type the company id to confirm.', 400);
      await deleteCompany(companiesDir, cid);
      return ok(res);

    // ── Goals ──
    case 'goals': return mutate(res, cid, body, (s) => {
      const existing = s.goals.find((g) => g.id === body.id) ?? null;
      const v = validateGoal(body, s.goals, existing);
      if (!v.ok) return { error: v.error };
      upsert(s.goals, v.goal);
      return { goal: v.goal, log: [entry('you', existing ? 'edited' : 'created', { type: 'goal', id: v.goal.id }, `Goal: ${v.goal.title}`, now)] };
    });
    case 'goals/delete': return mutate(res, cid, body, (s) => {
      const g = s.goals.find((x) => x.id === body.id);
      if (!g) return { error: 'That goal does not exist.' };
      s.goals = s.goals.filter((x) => x.id !== g.id).map((x) => (x.parentId === g.id ? { ...x, parentId: g.parentId } : x));
      for (const i of s.issues) if (i.goalId === g.id) i.goalId = null;
      return { log: [entry('you', 'deleted', { type: 'goal', id: g.id }, `Goal: ${g.title}`, now)] };
    });

    // ── Issues ──
    case 'issues': return mutate(res, cid, body, async (s) => {
      const existing = s.issues.find((i) => i.id === body.id) ?? null;
      // "In progress" is not something a person sets — it is an agent checking the issue out.
      // Asking for it means "start this now": it goes to To do and its assignee is woken.
      const start = body.status === 'in_progress' && existing?.status !== 'in_progress';
      const reopen = existing && ['in_review', 'done', 'blocked', 'cancelled'].includes(existing.status) && ['todo', 'backlog'].includes(body.status ?? (start ? 'todo' : ''));
      const input = { ...body, status: start ? 'todo' : body.status };
      const v = validateIssue(input, s, existing, now);
      if (!v.ok) return { error: v.error };
      if (reopen || start) v.issue.work = null;
      if (reopen) await retireWork(workPaths(companiesDir, cid).result(v.issue.id));
      upsert(s.issues, v.issue);
      s.company.nextIssue = Math.max(s.company.nextIssue ?? 1, v.nextIssue);
      const who = s.employees.find((e) => e.id === v.issue.assignee);
      if (start && who) who.live = { ...who.live, wake: true };
      const key = issueKey(s.company, v.issue);
      const what = !existing ? `${key} created: ${v.issue.title}`
        : existing.status !== v.issue.status ? `${key} moved to ${v.issue.status.replace('_', ' ')}`
          : existing.assignee !== v.issue.assignee ? `${key} assigned to ${who?.name ?? 'nobody'}` : `${key} edited`;
      return { issue: v.issue, wake: true, log: [entry('you', existing ? 'updated' : 'created', { type: 'issue', id: v.issue.id }, what, now)] };
    });
    case 'issues/delete': return mutate(res, cid, body, (s) => {
      const i = s.issues.find((x) => x.id === body.id);
      if (!i) return { error: 'That issue does not exist.' };
      if (i.status === 'in_progress') return { error: 'Someone is working on it. Cancel it first, or wait.' };
      s.issues = s.issues.filter((x) => x.id !== i.id);
      for (const o of s.issues) {
        o.blockedBy = (o.blockedBy ?? []).filter((b) => b !== i.id);
        if (o.parentId === i.id) o.parentId = i.parentId ?? null;
      }
      return { log: [entry('you', 'deleted', { type: 'issue', id: i.id }, `${issueKey(s.company, i)} deleted: ${i.title}`, now)] };
    });
    case 'issues/comment': return mutate(res, cid, body, (s) => {
      const i = s.issues.find((x) => x.id === body.id);
      const words = text(body.text, 4000);
      if (!i) return { error: 'That issue does not exist.' };
      if (!words) return { error: 'Type something first.' };
      i.comments.push({ by: 'you', at: now, text: words });
      i.updatedAt = now;
      const key = issueKey(s.company, i);
      // A note on an issue someone is working on right now reaches them straight away.
      const e = s.employees.find((x) => x.id === i.assignee);
      const tell = i.status === 'in_progress' && e;
      return {
        told: !!tell,
        after: tell ? async () => {
          const view = await companyView(cid);
          office.tell(cid, e.id, `A note from the board on ${key}: <<<${words.replaceAll('>>>', '> > >')}>>>`, view?.live ?? {}).catch(() => {});
        } : null,
        log: [entry('you', 'commented', { type: 'issue', id: i.id }, `On ${key}: ${words.slice(0, 160)}`, now)],
      };
    });

    // ── Employees ──
    case 'employees': return mutate(res, cid, body, async (s) => {
      const existing = s.employees.find((e) => e.id === body.id) ?? null;
      const v = validateEmployee(body, s.employees, existing);
      if (!v.ok) return { error: v.error };
      // Hiring an agent that is already running: it keeps its conversation and just joins.
      if (!existing && isValidPaneId(body.bindPane)) {
        const snap = await freshSnapshot(0);
        const a = snap.ok ? listAgents(buildModel(snap.snapshot)).find((x) => x.id === body.bindPane) : null;
        if (!a) return { error: 'That agent is no longer running.' };
        v.employee.paneId = a.id;
        v.employee.session = a.session ?? null;
      }
      upsert(s.employees, v.employee);
      return { employee: v.employee, wake: true, log: [entry('you', existing ? 'edited' : 'hired', { type: 'employee', id: v.employee.id },
        existing ? `${v.employee.name}'s role changed.` : `${v.employee.name} hired as ${v.employee.title}.`, now)] };
    });
    case 'employees/pause':
    case 'employees/resume':
    case 'employees/wake':
    case 'employees/terminate': return mutate(res, cid, body, async (s) => {
      const e = s.employees.find((x) => x.id === body.id);
      if (!e) return { error: 'That employee does not exist.' };
      const verb = action.split('/')[1];
      if (verb === 'pause') e.state = 'paused';
      if (verb === 'resume') { e.state = 'active'; e.live = { ...e.live, wake: true }; }
      if (verb === 'wake') {
        if (e.state !== 'active') return { error: `${e.name} is ${e.state} — resume them first.` };
        e.live = { ...e.live, wake: true };
      }
      if (verb === 'terminate') {
        const view = await companyView(cid);
        const pane = view?.live?.[e.id]?.paneId;
        if (pane) await office.close(pane).catch(() => {});
        e.state = 'terminated';
        e.paneId = null;
        for (const i of s.issues.filter((x) => x.assignee === e.id && !['done', 'cancelled'].includes(x.status))) {
          i.assignee = null; i.status = 'backlog'; i.work = null;
        }
        for (const r of s.employees.filter((x) => x.reportsTo === e.id)) r.reportsTo = e.reportsTo;
      }
      const words = { pause: 'paused — no new work', resume: 'resumed', wake: 'woken to check their queue now', terminate: 'let go; their agent was closed and their open issues went back to the backlog' };
      const past = { pause: 'paused', resume: 'resumed', wake: 'woke', terminate: 'terminated' };
      return { wake: verb !== 'pause', log: [entry('you', past[verb], { type: 'employee', id: e.id }, `${e.name} ${words[verb]}.`, now)] };
    });

    // ── Routines ──
    case 'routines': return mutate(res, cid, body, (s) => {
      const existing = s.routines.find((r) => r.id === body.id) ?? null;
      const v = validateRoutine(body, s, existing);
      if (!v.ok) return { error: v.error };
      if (v.routine.enabled && !existing?.enabled) v.routine.enabledAt = now;
      else v.routine.enabledAt = existing?.enabledAt ?? now;
      upsert(s.routines, v.routine);
      return { routine: v.routine, log: [entry('you', existing ? 'edited' : 'created', { type: 'routine', id: v.routine.id }, `Routine: ${v.routine.title}`, now)] };
    });
    case 'routines/delete': return mutate(res, cid, body, (s) => {
      const r = s.routines.find((x) => x.id === body.id);
      if (!r) return { error: 'That routine does not exist.' };
      s.routines = s.routines.filter((x) => x.id !== r.id);
      return { log: [entry('you', 'deleted', { type: 'routine', id: r.id }, `Routine: ${r.title}`, now)] };
    });

    // ── Governance ──
    case 'approvals/decide': return mutate(res, cid, body, (s) => {
      const d = applyApproval(s, String(body.id ?? ''), body.decision === 'approve' ? 'approve' : 'reject', { now, note: body.note, raiseTo: body.raiseTo });
      if (!d.ok) return { error: d.error };
      Object.assign(s, d.state);
      return {
        wake: true,
        after: d.effects.length ? async () => {
          const view = await companyView(cid);
          for (const f of d.effects) office.tell(cid, f.employeeId, f.text, view?.live ?? {}).catch(() => {});
        } : null,
        log: d.log,
      };
    });

    // "Plan this goal": the top of the company gets an issue whose whole job is to split the goal
    // into issues for the team. What it writes comes back as a plan in the Inbox.
    case 'plan': return mutate(res, cid, body, (s) => {
      const goal = s.goals.find((g) => g.id === body.goalId) ?? null;
      const what = goal ? goal.title : text(body.text, 2000);
      if (!what) return { error: 'Say what should be planned.' };
      const top = s.employees.find((e) => !e.reportsTo && e.state === 'active');
      if (!top) return { error: 'Nobody is active at the top of the company to plan it. Hire or resume a CEO first.' };
      const v = validateIssue({ title: `Plan: ${what}`.slice(0, 200), body: goal?.detail || (goal ? '' : what), assignee: top.id, goalId: goal?.id ?? null,
        priority: 'high', kind: 'plan', status: 'todo' }, s, null, now);
      if (!v.ok) return { error: v.error };
      s.issues.push(v.issue);
      s.company.nextIssue = v.nextIssue;
      top.live = { ...top.live, wake: true };
      return { issue: v.issue, wake: true, log: [entry('you', 'asked for a plan', { type: 'issue', id: v.issue.id },
        `${top.name} will plan "${what}" as ${issueKey(s.company, v.issue)}.`, now)] };
    });
    default: return fail(res, 'Not found', 404);
  }
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
    const snap = await freshSnapshot();
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
    const file = config.herdrConfigPath || (process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? '', 'herdr', 'config.toml')
      : path.join(os.homedir(), '.config', 'herdr', 'config.toml'));
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
    return ok(res, { projects: await listProjects(config.projectRoots?.length ? config.projectRoots : [os.homedir()], inUse) });
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

  const co = url.pathname.match(/^\/api\/c\/([a-z0-9-]+)\/([a-z/-]+)$/);
  if (co) return companyRoute(req, res, co[1], co[2], url, post);
  if (url.pathname.startsWith('/api/companies')) return companiesRoute(req, res, url, post);

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
  console.log(`Companies kept in: ${companiesDir}`);
  if (beat.enabled) office.start(beat.tickMs);
  openBrowser();
});
