// The lines drawn between agents on the map, and what they mean.
//
// A line is not a drawing: it is a CONNECTION, and the words each connected agent is told
// come from src/team.mjs, not from anything invented here. This module holds the lines and
// talks to the server about them. It draws nothing — index.html does that.
import { get, post } from './ui.js';

let kinds = {};        // served by the API: manages · parallel · colleague
let lines = [];        // { from, to, kind }

/** The kinds, in the order they should be offered. Empty until loadKinds() has returned. */
export const kindList = () => Object.entries(kinds).map(([key, v]) => ({ key, ...v }));

/** The default when nothing has been chosen — the first kind the server offers. */
export const firstKind = () => Object.keys(kinds)[0] ?? 'manages';

/** Every line, with the words for what it means and its position in the list. */
export const wires = () => lines.map((w, i) => ({ ...w, i, label: kinds[w.kind]?.label ?? w.kind }));

/**
 * Join two agents.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
export function addWire(from, to, kind) {
  if (!from || !to || from === to) return { ok: false, error: 'Connect it to a different agent.' };
  const k = kinds[kind] ? kind : firstKind();
  if (!lines.some((w) => w.from === from && w.to === to && w.kind === k)) lines.push({ from, to, kind: k });
  return { ok: true };
}

export const removeWire = (i) => { lines.splice(i, 1); };
export const clearWires = () => { lines = []; };

export function setWireKind(i, kind) {
  if (lines[i] && kinds[kind]) lines[i].kind = kind;
}

/**
 * How many separate groups the lines add up to — the same grouping the server will do,
 * so the number you are shown before sending is the number that actually gets a job.
 */
export function groupCount() {
  const leaders = new Set(lines.filter((w) => kinds[w.kind]?.needsLeader).map((w) => w.from));
  const seen = new Map();
  for (const w of lines.filter((w) => !kinds[w.kind]?.needsLeader)) {
    const set = new Set([...(seen.get(w.from) ?? [w.from]), ...(seen.get(w.to) ?? [w.to])]);
    for (const id of set) seen.set(id, set);
  }
  return leaders.size + new Set(seen.values()).size;
}

/** The kinds come from the same place the Connections panel gets them. One source, not two. */
export async function loadKinds() {
  const r = await get('/api/teams');
  if (r.ok) kinds = r.kinds ?? kinds;
  return kinds;
}

/** Give every joined-up group the same job, each agent told its own part. */
export const sendJob = (task) => post('/api/connections/dispatch', { wires: lines, task });
