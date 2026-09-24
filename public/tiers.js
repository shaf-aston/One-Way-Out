// Pure: the lines between agents, read as a chain of command. No DOM, no I/O — the same
// module the page draws from and the checks run against, so there is one answer to "who is
// above whom" rather than two that can drift apart.

/** Only some kinds put one agent above another. A line between equals never makes a tier. */
export const RANKS = new Set(['manages', 'handoff']);

/**
 * Read the lines as tiers.
 * An agent sits one row below whoever leads it, and the LONGEST run of arrows wins — so an
 * agent that is both a leader and led never appears above the one leading it. Agents that no
 * ranking line touches are not given a made-up place: they come back separately.
 *
 * Within a row, agents are ordered to sit under their own leader, which is what stops the
 * arrows crossing over each other into an unreadable knot.
 *
 * @param {Array<{from:string,to:string,kind:string}>} wires
 * @param {string[]} ids - the agents actually running; a line to a closed agent is ignored
 * @returns {{tiers:string[][], loose:string[]}}
 */
export function tiersOf(wires = [], ids = []) {
  const live = new Set(ids);
  const edges = (wires ?? []).filter((w) => RANKS.has(w.kind) && live.has(w.from) && live.has(w.to));
  if (!edges.length) return { tiers: [], loose: [...ids] };

  const below = new Map();
  const led = new Set();
  for (const e of edges) {
    if (!below.has(e.from)) below.set(e.from, new Set());
    below.get(e.from).add(e.to);
    led.add(e.to);
  }

  const inChain = new Set(edges.flatMap((e) => [e.from, e.to]));
  const depth = new Map();
  // Everyone with nobody above them starts at the top. Drawn as a ring, nobody qualifies —
  // begin at whichever comes first so the tiers are still drawn instead of coming back empty.
  let front = [...inChain].filter((id) => !led.has(id));
  if (!front.length) front = [[...inChain][0]];
  for (const id of front) depth.set(id, 0);

  // The step count is capped by the number of agents: two of them can be drawn as each
  // other's leader, and a cycle has to settle rather than spin.
  for (let step = 0; step < inChain.size && front.length; step += 1) {
    const next = [];
    for (const id of front) {
      for (const child of below.get(id) ?? []) {
        const d = depth.get(id) + 1;
        if ((depth.get(child) ?? -1) >= d) continue;
        depth.set(child, d);
        next.push(child);
      }
    }
    front = next;
  }

  const tiers = Array.from({ length: Math.max(...depth.values()) + 1 }, () => []);
  for (const id of ids) if (depth.has(id)) tiers[depth.get(id)].push(id);

  // Sit each agent under its own leader. Anything whose leader is not on the row above keeps
  // its original order at the end, rather than being shuffled somewhere arbitrary.
  for (let i = 1; i < tiers.length; i += 1) {
    const above = tiers[i - 1];
    const under = (id) => {
      const at = above.findIndex((p) => below.get(p)?.has(id));
      return at < 0 ? above.length : at;
    };
    const was = new Map(tiers[i].map((id, n) => [id, n]));
    tiers[i].sort((x, y) => under(x) - under(y) || was.get(x) - was.get(y));
  }

  return { tiers, loose: ids.filter((id) => !depth.has(id)) };
}
