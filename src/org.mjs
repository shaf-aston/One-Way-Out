// Pure core: the ready-made shapes for a chain of command, and how the lines are remembered.
// No I/O. Reading the lines back AS tiers is public/tiers.js — the page needs that on every
// repaint, so it lives where the page can import it, and is checked from there.

import { MAX_WIRES } from './team.mjs';

/**
 * The ready-made shapes. One click builds the whole set of lines; every one of them can then
 * be changed or removed by hand, exactly as if it had been drawn.
 */
export const PRESETS = [
  {
    id: 'one-leader',
    name: 'One leader, the rest report',
    why: 'The first agent splits the job, hands out the parts, and answers for all of it.',
  },
  {
    id: 'two-teams',
    name: 'Two teams under one leader',
    why: 'One agent on top, two team leads under it, everyone else split between them.',
  },
  {
    id: 'assembly-line',
    name: 'Assembly line',
    why: 'Each agent finishes its part and hands the result to the next one along.',
  },
  {
    id: 'all-equals',
    name: 'All equals',
    why: 'Nobody in charge. Each checks with the others before touching shared ground.',
  },
  {
    id: 'none',
    name: 'No connections',
    why: 'Removes every line. The agents themselves are not touched.',
  },
];

const pair = (from, to, kind) => ({ from, to, kind });

/**
 * The lines one preset stands for, over the agents given, in the order they are shown.
 * @returns {Array<{from:string,to:string,kind:string}>} — empty for an unknown preset or too
 *   few agents to make that shape, which the caller reports rather than silently half-applying.
 */
export function applyPreset(id, agentIds = []) {
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (id === 'none' || ids.length < 2) return [];

  if (id === 'one-leader') {
    const [boss, ...rest] = ids;
    return rest.map((r) => pair(boss, r, 'manages')).slice(0, MAX_WIRES);
  }

  if (id === 'assembly-line') {
    return ids.slice(0, -1).map((from, i) => pair(from, ids[i + 1], 'handoff')).slice(0, MAX_WIRES);
  }

  if (id === 'all-equals') {
    // A line between each neighbour is enough: everything joined up is one group.
    return ids.slice(0, -1).map((from, i) => pair(from, ids[i + 1], 'colleague')).slice(0, MAX_WIRES);
  }

  if (id === 'two-teams') {
    if (ids.length < 4) return applyPreset('one-leader', ids);   // too few to split in two
    const [boss, leadA, leadB, ...crew] = ids;
    const half = Math.ceil(crew.length / 2);
    return [
      pair(boss, leadA, 'manages'),
      pair(boss, leadB, 'manages'),
      ...crew.slice(0, half).map((c) => pair(leadA, c, 'manages')),
      ...crew.slice(half).map((c) => pair(leadB, c, 'manages')),
    ].slice(0, MAX_WIRES);
  }

  return [];
}

/* ── Remembering the lines ──
   A pane id is where an agent sits right now, and moving it changes that. What a line is
   really between is two conversations, so that is what gets written to disk. */

/** Pane ids -> conversation ids, for saving. A line touching an agent with no conversation
 *  id yet (one still starting up) is dropped rather than saved against something unstable. */
export function toSaved(wires = [], agents = []) {
  const session = new Map(agents.map((a) => [a.id, a.session]));
  return (wires ?? [])
    .map((w) => ({ from: session.get(w.from), to: session.get(w.to), kind: w.kind }))
    .filter((w) => w.from && w.to && w.from !== w.to);
}

/** Conversation ids -> pane ids, for drawing. A line whose agent is gone is left out. */
export function fromSaved(saved = [], agents = []) {
  const pane = new Map(agents.filter((a) => a.session).map((a) => [a.session, a.id]));
  return (saved ?? [])
    .map((w) => ({ from: pane.get(w.from), to: pane.get(w.to), kind: w.kind }))
    .filter((w) => w.from && w.to);
}
