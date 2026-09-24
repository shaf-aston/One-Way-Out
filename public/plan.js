// Pure: what an already-checked plan looks like — the pieces the approval screen (and
// verify.mjs) need on every repaint. Checking a plan a planner agent WROTE is a trust
// boundary and stays server-side (src/plan.mjs validatePlan); this only reads a plan that
// has already passed that check.

/**
 * Which files two or more tasks both claim. Not an error — the approval screen shows it and
 * the operator decides, per his "one shared folder, with lanes" call.
 * @returns {Array<{file:string, taskIds:string[]}>}
 */
export function lanesClash(plan) {
  const claims = new Map();
  for (const t of plan?.tasks ?? []) {
    for (const file of t.lane ?? []) {
      if (!claims.has(file)) claims.set(file, []);
      claims.get(file).push(t.id);
    }
  }
  return [...claims.entries()].filter(([, ids]) => ids.length > 1).map(([file, taskIds]) => ({ file, taskIds }));
}

/** The plan's links, in the shape #/org already draws — parent is "manages", after is "handoff". */
export function tasksToWires(plan) {
  const wires = [];
  for (const t of plan?.tasks ?? []) {
    if (t.parent) wires.push({ from: t.parent, to: t.id, kind: 'manages' });
    if (t.after) wires.push({ from: t.after, to: t.id, kind: 'handoff' });
  }
  return wires;
}
