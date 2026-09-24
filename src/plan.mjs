// Pure core: the shape of a run's plan, and the pure questions asked of it while it runs.
// No I/O — a plan is text a Claude agent wrote to a file, so every field here is a trust
// boundary, checked the same way src/flows.mjs checks a saved workflow. Only the server
// needs that check, so it stays here; the display-only derivations the browser also needs
// (lanesClash, tasksToWires) live in public/plan.js instead — the same split public/tiers.js
// already draws.
//
// A task sits in a tree two ways at once, and they mean different things:
//   parent  — who LEADS it (a "manages" wire). Does not gate when it starts — a leader
//             delegates and its children work at the same time as it does.
//   after   — who it picks up FROM (a "handoff" wire). Gates starting: it waits until
//             the task named in `after` has written its result.
import { isValidId } from './ids.mjs';

// The caps below are only defaults — server.mjs is the sole reader of config.json, and passes
// its own `run` block down as `limits` on every real call. A caller that omits `limits`
// (every existing test in scripts/verify.mjs, and any pure use of this module) still gets
// sane behaviour instead of needing to know these numbers.
export const DEFAULT_MAX_AGENTS = 8;
export const DEFAULT_MAX_DEPTH = 3;
const MAX_BRIEF = 4000;
const MAX_LANES = 20;
const MODELS = ['opus', 'sonnet', 'haiku'];

const text = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * Check a plan a planner agent wrote before anything acts on it (trust boundary).
 * @param {{maxAgents?:number, maxDepth?:number}} [limits]
 * @returns {{ok:true, plan:object}|{ok:false, error:string}}
 */
export function validatePlan(input, limits = {}) {
  const maxAgents = limits.maxAgents ?? DEFAULT_MAX_AGENTS;
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;

  const goal = text(input?.goal, 400);
  if (!goal) return { ok: false, error: 'The plan has no goal.' };
  const folder = text(input?.folder, 400);
  if (!folder) return { ok: false, error: 'The plan names no folder to work in.' };

  const rawTasks = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!rawTasks.length) return { ok: false, error: 'The plan has no tasks.' };
  if (rawTasks.length > maxAgents) return { ok: false, error: `Too many tasks (${maxAgents} max).` };

  const seen = new Set();
  const tasks = [];
  for (const [i, t] of rawTasks.entries()) {
    const at = `Task ${i + 1}`;
    const id = text(t?.id, 48);
    if (!isValidId(id)) return { ok: false, error: `${at}: needs a plain lowercase id.` };
    if (seen.has(id)) return { ok: false, error: `${at}: id "${id}" is used twice.` };
    seen.add(id);

    const brief = text(t?.brief, MAX_BRIEF);
    if (!brief) return { ok: false, error: `${at} (${id}): needs a brief — what this agent actually does.` };

    tasks.push({
      id,
      title: text(t?.title, 80) || id,
      brief,
      model: MODELS.includes(t?.model) ? t.model : 'sonnet',
      lane: Array.isArray(t?.lane)
        ? [...new Set(t.lane.map((f) => text(f, 200)).filter(Boolean))].slice(0, MAX_LANES)
        : [],
      done: text(t?.done, 200),
      parent: t?.parent == null ? null : text(t.parent, 48),
      after: t?.after == null ? null : text(t.after, 48),
    });
  }

  for (const t of tasks) {
    if (t.parent === t.id) return { ok: false, error: `Task "${t.id}": cannot be its own parent.` };
    if (t.parent != null && !seen.has(t.parent)) return { ok: false, error: `Task "${t.id}": parent "${t.parent}" does not exist.` };
    if (t.after === t.id) return { ok: false, error: `Task "${t.id}": cannot come after itself.` };
    if (t.after != null && !seen.has(t.after)) return { ok: false, error: `Task "${t.id}": comes after "${t.after}", which does not exist.` };
  }
  if (hasCycle(tasks)) return { ok: false, error: 'The plan has a cycle — a task leads back to itself through parent or after links.' };

  const plan = { goal, folder, tasks };
  const depth = planDepth(plan);
  if (depth > maxDepth) return { ok: false, error: `The chain of command is ${depth} levels deep — ${maxDepth} is the most this app runs.` };

  return { ok: true, plan };
}

/** Follows both parent and after links — either one looping back on itself is a cycle. */
function hasCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // 0 unvisited (absent), 1 visiting, 2 settled
  const visit = (id) => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const next of [byId.get(id).parent, byId.get(id).after].filter(Boolean)) {
      if (visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return tasks.some((t) => visit(t.id));
}

/** How many tiers the `parent` links make — the same "longest run wins" rule public/tiers.js uses. */
export function planDepth(plan) {
  const tasks = plan?.tasks ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depthOf = (id, guard = tasks.length + 1) => {
    if (guard <= 0) return 0; // a cycle would spin forever otherwise; validatePlan rejects one anyway
    const t = byId.get(id);
    if (!t || t.parent == null) return 0;
    return 1 + depthOf(t.parent, guard - 1);
  };
  return tasks.reduce((max, t) => Math.max(max, depthOf(t.id) + 1), 0);
}

/**
 * Ids that can be started right now: still pending, and — if it hands off from another
 * task — that task has already finished. `parent` never gates starting; a leader delegates
 * and its children run alongside it, not after it.
 * @param {{plan:object, tasks:Record<string,{state:string}>}} run
 */
export function readyTasks(run) {
  const plan = run?.plan;
  const state = run?.tasks ?? {};
  if (!plan) return [];
  return plan.tasks
    .filter((t) => (state[t.id]?.state ?? 'pending') === 'pending')
    .filter((t) => !t.after || state[t.after]?.state === 'done')
    .map((t) => t.id);
}

/**
 * Ids of leaders whose every direct child has finished, and who have not already been told
 * to roll up (its own state would be 'rolling' or 'done' by then). The caller sends the
 * rollup message and marks the leader 'rolling' so this never fires twice for the same run.
 * @param {{plan:object, tasks:Record<string,{state:string}>}} run
 */
export function rollupReady(run) {
  const plan = run?.plan;
  const state = run?.tasks ?? {};
  if (!plan) return [];
  const childrenOf = new Map();
  for (const t of plan.tasks) {
    if (!t.parent) continue;
    if (!childrenOf.has(t.parent)) childrenOf.set(t.parent, []);
    childrenOf.get(t.parent).push(t.id);
  }
  const out = [];
  for (const [parentId, kids] of childrenOf) {
    const parentState = state[parentId]?.state;
    if (parentState === 'rolling' || parentState === 'done') continue;
    if (kids.every((k) => state[k]?.state === 'done')) out.push(parentId);
  }
  return out;
}
