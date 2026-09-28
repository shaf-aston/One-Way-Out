// Pure core: what a company IS — its record, its goals, its employees, its routines — and the
// checks every one of them passes before it is kept. No I/O.
//
// A company is the Paperclip idea brought to Herdr: one mission, goals under it, issues under
// those, and AI agents hired as employees with a title, a job, someone they report to and a
// budget. Everything a browser or an agent sends is checked here first (trust boundary), the
// same way src/moves.mjs checks a destination: only the fields named here survive.
import { isValidId, slugify } from './ids.mjs';

export const MODELS = ['opus', 'sonnet', 'haiku'];

/** Where an employee is in its working life. Only `active` ever gets work. */
export const EMPLOYEE_STATES = {
  active: 'Working normally',
  paused: 'Paused by you — gets no new work',
  'over-budget': 'Hit a budget cap — waiting for you in the Inbox',
  terminated: 'Let go — its agent was closed',
};

export const text = (v, n) => String(v ?? '').trim().slice(0, n);
const int = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

/**
 * A new id that no record in `taken` already uses: `slug`, then `slug-2`, `slug-3`…
 * Deterministic, so the same inputs always make the same id — easy to read and to test.
 */
export function freshId(wanted, taken = [], fallback = 'item') {
  const used = new Set(taken);
  const base = (slugify(wanted) || fallback).slice(0, 40).replace(/-+$/, '') || fallback;
  if (!used.has(base) && isValidId(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Issue keys read like Paperclip's: ACME-12. The prefix is the company's, uppercase letters only. */
export const prefixOf = (name) => (String(name ?? '').replace(/[^a-z]/gi, '').slice(0, 4) || 'CO').toUpperCase();

/** Check a new company before it is created. */
export function validateCompany(input, takenIds = []) {
  const name = text(input?.name, 60);
  if (!name) return { ok: false, error: 'Give the company a name.' };
  const folder = text(input?.folder, 400);
  if (!folder || !/^([a-zA-Z]:[\\/]|\/)/.test(folder)) return { ok: false, error: 'Pick the folder its agents work in (a full path).' };
  return {
    ok: true,
    company: {
      id: freshId(name, takenIds, 'company'),
      name,
      prefix: prefixOf(name),
      mission: text(input?.mission, 600),
      folder,
      running: false,
      // Whether finished work lands in Done by itself or waits in Review for you.
      review: input?.review === 'you' ? 'you' : 'auto',
      // Whether a plan an agent writes (issues, hires) waits for your approval first.
      approvePlans: input?.approvePlans !== false,
      nextIssue: 1,
    },
  };
}

/** Only these company fields may be changed after it exists. */
export function patchCompany(company, input) {
  const next = { ...company };
  if (input?.name != null && text(input.name, 60)) next.name = text(input.name, 60);
  if (input?.mission != null) next.mission = text(input.mission, 600);
  if (input?.review != null) next.review = input.review === 'you' ? 'you' : 'auto';
  if (input?.approvePlans != null) next.approvePlans = !!input.approvePlans;
  if (input?.running != null) next.running = !!input.running;
  return next;
}

/** A budget: each cap is a whole number, 0 meaning "no cap". */
export function cleanBudget(b) {
  return {
    tasksPerDay: int(b?.tasksPerDay, 0, 1000, 0),
    activeMinPerDay: int(b?.activeMinPerDay, 0, 1440, 0),
    tokensPerMonth: int(b?.tokensPerMonth, 0, 1e10, 0),
  };
}

/** Would `id` reporting to `boss` make someone their own manager, however far up? */
export function makesLoop(id, boss, employees = []) {
  const up = new Map(employees.map((e) => [e.id, e.reportsTo]));
  up.set(id, boss);
  let at = boss;
  for (let i = 0; at && i <= employees.length + 1; i += 1) {
    if (at === id) return true;
    at = up.get(at);
  }
  return false;
}

/**
 * Check an employee before it is hired or changed (trust boundary). `existing` is the record
 * being edited, if any — its working state and usage are kept, never taken from the input.
 */
export function validateEmployee(input, employees = [], existing = null) {
  const name = text(input?.name, 40);
  if (!name) return { ok: false, error: 'Give them a name.' };
  const title = text(input?.title, 60) || 'Engineer';
  const others = employees.filter((e) => e.id !== existing?.id);
  const reportsTo = input?.reportsTo ? text(input.reportsTo, 49) : null;
  if (reportsTo && !others.some((e) => e.id === reportsTo)) return { ok: false, error: 'They report to someone who is not in this company.' };
  const id = existing?.id ?? freshId(name, employees.map((e) => e.id), 'agent');
  if (reportsTo && makesLoop(id, reportsTo, others)) return { ok: false, error: 'That would make them their own manager.' };
  return {
    ok: true,
    employee: {
      id,
      name,
      title,
      job: text(input?.job, 2000),
      reportsTo,
      model: MODELS.includes(input?.model) ? input.model : 'sonnet',
      // How often it looks at its queue: 0 = the moment work is assigned.
      everyMin: int(input?.everyMin, 0, 1440, 0),
      budget: cleanBudget(input?.budget ?? existing?.budget),
      state: existing?.state ?? 'active',
      session: existing?.session ?? null,
      paneId: existing?.paneId ?? null,
      usage: existing?.usage ?? {},
      live: existing?.live ?? {},
    },
  };
}

/** Check a goal. Goals nest; the mission sits above all of them. */
export function validateGoal(input, goals = [], existing = null) {
  const title = text(input?.title, 120);
  if (!title) return { ok: false, error: 'Say what the goal is.' };
  const parentId = input?.parentId ? text(input.parentId, 49) : null;
  if (parentId && !goals.some((g) => g.id === parentId && g.id !== existing?.id)) return { ok: false, error: 'That parent goal does not exist.' };
  const id = existing?.id ?? freshId(title, goals.map((g) => g.id), 'goal');
  if (parentId && makesLoop(id, parentId, goals.map((g) => ({ id: g.id, reportsTo: g.parentId })))) {
    return { ok: false, error: 'A goal cannot sit under itself.' };
  }
  return {
    ok: true,
    goal: { id, title, parentId, detail: text(input?.detail, 1000), done: !!(input?.done ?? existing?.done) },
  };
}

/** How often a routine fires. Kept small on purpose: every N minutes, or a time each (week)day. */
export function cleanSchedule(s) {
  const kind = ['every', 'daily', 'weekdays'].includes(s?.kind) ? s.kind : 'daily';
  if (kind === 'every') return { kind, everyMin: int(s?.everyMin, 5, 10080, 60) };
  const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s?.at ?? '')) ? s.at : '09:00';
  return { kind, at };
}

/** Check a routine: a schedule that creates one issue each time it fires. */
export function validateRoutine(input, { routines = [], employees = [] } = {}, existing = null) {
  const title = text(input?.title, 120);
  if (!title) return { ok: false, error: 'Give the routine a title — it becomes each issue\'s title.' };
  const assignee = input?.assignee ? text(input.assignee, 49) : null;
  if (assignee && !employees.some((e) => e.id === assignee)) return { ok: false, error: 'That employee is not in this company.' };
  return {
    ok: true,
    routine: {
      id: existing?.id ?? freshId(title, routines.map((r) => r.id), 'routine'),
      title,
      body: text(input?.body, 4000),
      assignee,
      schedule: cleanSchedule(input?.schedule),
      enabled: input?.enabled !== false,
      lastFiredAt: existing?.lastFiredAt ?? null,
    },
  };
}

/**
 * Why an issue exists, top down: the mission, each goal above it, each parent issue.
 * This is what every brief opens with, so an agent knows what its work is FOR.
 */
export function whyChain(issue, { company, goals = [], issues = [] }) {
  const chain = [];
  const parents = [];
  const byIssue = new Map(issues.map((i) => [i.id, i]));
  for (let p = byIssue.get(issue?.parentId), n = 0; p && n < 10; p = byIssue.get(p.parentId), n += 1) parents.unshift(p);
  const goalId = parents[0]?.goalId ?? issue?.goalId;
  const byGoal = new Map(goals.map((g) => [g.id, g]));
  const goalLine = [];
  for (let g = byGoal.get(goalId), n = 0; g && n < 10; g = byGoal.get(g.parentId), n += 1) goalLine.unshift(g);
  if (company?.mission) chain.push({ kind: 'mission', text: company.mission });
  for (const g of goalLine) chain.push({ kind: 'goal', id: g.id, text: g.title });
  for (const p of parents) chain.push({ kind: 'issue', id: p.id, text: p.title });
  return chain;
}

/**
 * The company as one portable file: everything needed to set it up again elsewhere, and
 * nothing tied to this machine — no pane ids, no conversations, no usage.
 */
export function exportBundle(state) {
  return {
    format: 'one-way-out-company/1',
    company: { ...state.company, running: false },
    goals: state.goals ?? [],
    employees: (state.employees ?? []).map(({ session, paneId, usage, live, ...e }) => ({
      ...e, state: e.state === 'terminated' ? 'terminated' : 'active',
    })),
    issues: (state.issues ?? []).map(({ work, ...i }) => ({ ...i, status: i.status === 'in_progress' ? 'todo' : i.status })),
    routines: (state.routines ?? []).map((r) => ({ ...r, lastFiredAt: null })),
  };
}

/**
 * Read an exported file back in. Every record goes through the same checks as one typed by
 * hand, so an imported file can carry nothing a form could not. The company gets a new id if
 * its old one is taken here; everything inside it keeps its own ids, since it has its own folder.
 */
export function importBundle(bundle, takenIds = []) {
  if (bundle?.format !== 'one-way-out-company/1') return { ok: false, error: 'That is not a company exported from One-Way-Out.' };
  const made = validateCompany(bundle.company, takenIds);
  if (!made.ok) return made;
  const company = { ...made.company, ...patchCompany(made.company, bundle.company), running: false,
    nextIssue: int(bundle.company?.nextIssue, 1, 1e6, 1), prefix: made.company.prefix };
  const goals = [];
  for (const g of bundle.goals ?? []) {
    const v = validateGoal(g, goals, { id: isValidId(g?.id) ? g.id : freshId(g?.title, goals.map((x) => x.id), 'goal') });
    if (v.ok) goals.push(v.goal);
  }
  const employees = [];
  for (const e of (bundle.employees ?? []).slice(0, 200)) {
    const id = isValidId(e?.id) ? e.id : freshId(e?.name, employees.map((x) => x.id), 'agent');
    const v = validateEmployee({ ...e, reportsTo: null }, employees, { id, state: e?.state === 'terminated' ? 'terminated' : 'active' });
    if (v.ok) employees.push({ ...v.employee, reportsTo: e?.reportsTo ?? null });
  }
  // Reporting lines second, once everyone exists; a line to nobody is dropped, not guessed.
  for (const e of employees) {
    if (e.reportsTo && (!employees.some((o) => o.id === e.reportsTo) || makesLoop(e.id, e.reportsTo, employees.filter((o) => o.id !== e.id)))) e.reportsTo = null;
  }
  const routines = [];
  for (const r of bundle.routines ?? []) {
    const v = validateRoutine(r, { routines, employees }, { id: isValidId(r?.id) ? r.id : freshId(r?.title, routines.map((x) => x.id), 'routine') });
    if (v.ok) routines.push(v.routine);
  }
  return { ok: true, company, goals, employees, routines, rawIssues: Array.isArray(bundle.issues) ? bundle.issues.slice(0, 5000) : [] };
}
