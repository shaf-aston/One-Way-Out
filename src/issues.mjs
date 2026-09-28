// Pure core: issues — the tickets every piece of work in a company is. No I/O.
//
// An issue is the one unit of work. A goal is split into issues, a routine creates issues, a
// manager delegates by creating issues, and an employee works exactly one issue at a time.
// Its status is the whole board:
//   backlog → todo → in_progress → in_review → done      (plus blocked, cancelled)
// Two rules nothing may break:
//   - ATOMIC CHECKOUT: an employee holds at most one in_progress issue, and an issue has one
//     assignee. That is what stops two agents writing over each other's work.
//   - An issue can only start once every issue in its `blockedBy` is done.
import { text, freshId } from './company.mjs';

export const STATUSES = [
  { id: 'backlog', label: 'Backlog', blurb: 'Written down, not ready to start.' },
  { id: 'todo', label: 'To do', blurb: 'Ready. Its assignee picks it up at their next heartbeat.' },
  { id: 'in_progress', label: 'In progress', blurb: 'Checked out by one employee, being worked now.' },
  { id: 'in_review', label: 'In review', blurb: 'Finished by the agent, waiting for you to accept it.' },
  { id: 'blocked', label: 'Blocked', blurb: 'Stuck — needs you, or the issue it waits on.' },
  { id: 'done', label: 'Done', blurb: 'Accepted.' },
  { id: 'cancelled', label: 'Cancelled', blurb: 'Not doing it.' },
];
const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const MAX_BLOCKERS = 20;
const MAX_LANES = 20;

/** ACME-12: how an issue is shown and spoken about. */
export const issueKey = (company, issue) => `${company?.prefix ?? 'CO'}-${issue?.number ?? '?'}`;

const cleanList = (v, n, max) => (Array.isArray(v) ? [...new Set(v.map((x) => text(x, n)).filter(Boolean))].slice(0, max) : []);

/**
 * Check an issue before it is kept (trust boundary). A new one takes the company's next number;
 * an edit keeps its number, its history and its work record, and only takes the fields named.
 * @returns {{ok:true, issue:object, nextIssue:number}|{ok:false, error:string}}
 */
export function validateIssue(input, { company, issues = [], employees = [], goals = [] }, existing = null, now = Date.now()) {
  const title = text(input?.title ?? existing?.title, 200);
  if (!title) return { ok: false, error: 'Give the issue a title.' };
  const assignee = input?.assignee !== undefined ? (input.assignee ? text(input.assignee, 49) : null) : existing?.assignee ?? null;
  if (assignee && !employees.some((e) => e.id === assignee)) return { ok: false, error: 'That employee is not in this company.' };
  const goalId = input?.goalId !== undefined ? (input.goalId ? text(input.goalId, 49) : null) : existing?.goalId ?? null;
  if (goalId && !goals.some((g) => g.id === goalId)) return { ok: false, error: 'That goal does not exist.' };
  const parentId = input?.parentId !== undefined ? (input.parentId ? text(input.parentId, 49) : null) : existing?.parentId ?? null;
  if (parentId && (parentId === existing?.id || !issues.some((i) => i.id === parentId))) return { ok: false, error: 'That parent issue does not exist.' };
  const blockedBy = input?.blockedBy !== undefined
    ? cleanList(input.blockedBy, 49, MAX_BLOCKERS).filter((b) => b !== existing?.id && issues.some((i) => i.id === b))
    : existing?.blockedBy ?? [];
  const status = STATUS_IDS.has(input?.status) ? input.status : existing?.status ?? (assignee ? 'todo' : 'backlog');
  const number = existing?.number ?? company?.nextIssue ?? issues.length + 1;
  const issue = {
    id: existing?.id ?? freshId(`${company?.prefix ?? 'co'}-${number}`, issues.map((i) => i.id), 'issue'),
    number,
    title,
    body: text(input?.body ?? existing?.body, 8000),
    status,
    priority: PRIORITIES.includes(input?.priority) ? input.priority : existing?.priority ?? 'medium',
    assignee,
    goalId,
    parentId,
    blockedBy,
    lane: input?.lane !== undefined ? cleanList(input.lane, 200, MAX_LANES) : existing?.lane ?? [],
    kind: existing?.kind ?? (input?.kind === 'plan' ? 'plan' : 'work'),
    createdBy: existing?.createdBy ?? (text(input?.createdBy, 49) || 'you'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    comments: existing?.comments ?? [],
    work: existing?.work ?? null,
  };
  if (status === 'in_progress') {
    const held = checkoutProblem(issue, issues);
    if (held) return { ok: false, error: held };
  }
  return { ok: true, issue, nextIssue: existing ? company?.nextIssue ?? number + 1 : number + 1 };
}

/** Why `issue` may not be in progress right now, or null if it may. */
export function checkoutProblem(issue, issues = []) {
  if (!issue.assignee) return 'Assign it to someone before it can be in progress.';
  const other = issues.find((i) => i.id !== issue.id && i.assignee === issue.assignee && i.status === 'in_progress');
  if (other) return `${issue.assignee} is already working on ${other.title} — one issue at a time.`;
  return null;
}

const RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));

/** Has every issue this one waits on been done? */
export const unblocked = (issue, issues = []) => {
  const byId = new Map(issues.map((i) => [i.id, i]));
  return (issue.blockedBy ?? []).every((b) => ['done', 'cancelled'].includes(byId.get(b)?.status ?? 'done'));
};

/**
 * What `employeeId` should work on next: its own `todo` issues whose blockers are all done,
 * most urgent first, then oldest. Empty if it already has one in progress (atomic checkout).
 */
export function readyFor(employeeId, issues = []) {
  if (issues.some((i) => i.assignee === employeeId && i.status === 'in_progress')) return [];
  return issues
    .filter((i) => i.assignee === employeeId && i.status === 'todo' && unblocked(i, issues))
    .sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || a.number - b.number);
}

/**
 * Which files two or more open issues both claim. Not an error — shown so you can decide.
 * @returns {Array<{file:string, issueIds:string[]}>}
 */
export function lanesClash(issues = []) {
  const claims = new Map();
  for (const i of issues.filter((x) => !['done', 'cancelled'].includes(x.status))) {
    for (const file of i.lane ?? []) {
      if (!claims.has(file)) claims.set(file, []);
      claims.get(file).push(i.id);
    }
  }
  return [...claims.entries()].filter(([, ids]) => ids.length > 1).map(([file, issueIds]) => ({ file, issueIds }));
}

/**
 * Check what an agent wrote when it delegated or planned (trust boundary: an agent wrote it).
 * The shape it is told to write:
 *   {"issues":[{"ref":"a","title":"…","body":"…","assignee":"<employee id>","priority":"high",
 *               "after":["<ref of another new issue>"],"lane":["src/x.js"]}],
 *    "hires":[{"name":"…","title":"…","job":"…","model":"sonnet","reportsTo":"<employee id>"}]}
 * `after` names other new issues by their `ref`, so a plan can say what waits on what before
 * any of them has a real id.
 * @returns {{ok:true, issues:object[], hires:object[]}|{ok:false, error:string}}
 */
export function validateDelegation(input, { employees = [], maxIssues = 12, maxHires = 4 } = {}) {
  const raw = Array.isArray(input?.issues) ? input.issues : [];
  const hiresRaw = Array.isArray(input?.hires) ? input.hires : [];
  if (!raw.length && !hiresRaw.length) return { ok: false, error: 'It lists no issues and no hires.' };
  if (raw.length > maxIssues) return { ok: false, error: `Too many issues at once (${maxIssues} max).` };
  if (hiresRaw.length > maxHires) return { ok: false, error: `Too many hires at once (${maxHires} max).` };
  const refs = new Set();
  const issues = [];
  for (const [n, r] of raw.entries()) {
    const title = text(r?.title, 200);
    if (!title) return { ok: false, error: `Issue ${n + 1} has no title.` };
    const ref = text(r?.ref, 40) || `n${n + 1}`;
    if (refs.has(ref)) return { ok: false, error: `The ref "${ref}" is used twice.` };
    refs.add(ref);
    const assignee = r?.assignee && employees.some((e) => e.id === r.assignee && e.state !== 'terminated') ? r.assignee : null;
    issues.push({
      ref, title, body: text(r?.body, 8000), assignee,
      priority: PRIORITIES.includes(r?.priority) ? r.priority : 'medium',
      after: cleanList(r?.after, 40, MAX_BLOCKERS), lane: cleanList(r?.lane, 200, MAX_LANES),
    });
  }
  for (const i of issues) {
    i.after = i.after.filter((a) => a !== i.ref && refs.has(a));
  }
  const hires = hiresRaw.map((h) => ({
    name: text(h?.name, 40), title: text(h?.title, 60), job: text(h?.job, 2000),
    model: h?.model, reportsTo: h?.reportsTo ?? null,
  })).filter((h) => h.name);
  return { ok: true, issues, hires };
}

/**
 * Turn a checked delegation into real issues under `parent`, numbered from the company's next.
 * `after` refs become `blockedBy` ids. Returns the new issues and the next number to use.
 */
export function issuesFromDelegation(delegation, { company, issues = [], parent = null, createdBy = 'you', now = Date.now() }) {
  let next = company?.nextIssue ?? issues.length + 1;
  const taken = issues.map((i) => i.id);
  const idOf = new Map();
  const made = delegation.issues.map((d) => {
    const number = next++;
    const id = freshId(`${company?.prefix ?? 'co'}-${number}`, taken, 'issue');
    taken.push(id);
    idOf.set(d.ref, id);
    return { d, id, number };
  });
  const out = made.map(({ d, id, number }) => ({
    id, number, title: d.title, body: d.body,
    status: d.assignee ? 'todo' : 'backlog', priority: d.priority, assignee: d.assignee,
    goalId: parent?.goalId ?? null, parentId: parent?.id ?? null,
    blockedBy: d.after.map((a) => idOf.get(a)).filter(Boolean),
    lane: d.lane, kind: 'work', createdBy, createdAt: now, updatedAt: now, comments: [], work: null,
  }));
  return { issues: out, nextIssue: next };
}
