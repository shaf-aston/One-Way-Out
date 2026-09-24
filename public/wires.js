// The lines drawn between agents on the map, and what they mean.
//
// A line is not a drawing: it is a CONNECTION, and the words each connected agent is told
// come from src/team.mjs, not from anything invented here. This module holds the lines and
// talks to the server about them. It draws nothing — index.html does that.
import { get, post, headMsg } from './ui.js';

let kinds = {};        // served by the API: manages · parallel · colleague
let lines = [];        // { from, to, kind }
let groups = 0;        // how many jobs one Send becomes — counted by the server, never here
// The count arrives with the server's reply, a moment after the line is drawn. Whoever paints
// the send bar says so here, or the bar keeps the number it had — measured 2026-09-04, drawing
// the first line left "1 connection · 0 groups" on screen until the page was reloaded.
let onSaved = () => {};
export const onWiresSaved = (fn) => { onSaved = fn; };

/** The kinds, in the order they should be offered. Empty until loadKinds() has returned. */
export const kindList = () => Object.entries(kinds).map(([key, v]) => ({ key, ...v }));

/** The default when nothing has been chosen — the first kind the server offers. */
const firstKind = () => Object.keys(kinds)[0] ?? 'manages';

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
  keep();
  return { ok: true };
}

export const removeWire = (i) => { lines.splice(i, 1); keep(); };
export const clearWires = () => { lines = []; keep(); };

/** Replace every line at once — what applying a ready-made shape does. */
export const setWires = (next) => { lines = (next ?? []).map((w) => ({ ...w })); keep(); };

export function setWireKind(i, kind) {
  if (lines[i] && kinds[kind]) lines[i].kind = kind;
  keep();
}

/**
 * How many separate groups the lines add up to, and therefore how many jobs one Send becomes.
 * The server counts it, because the server is what does the grouping (teamsFromWires in
 * src/team.mjs). Working it out here as well is how the number you are shown stopped matching
 * the number that gets a job — measured 2026-09-02, one line "side by side" and one
 * "colleagues" read as one group on screen and went out as two.
 */
export const groupCount = () => groups;

/** The meanings a line can have, served by the API so the words live in one file. */
export async function loadKinds() {
  const r = await get('/api/kinds');
  if (r.ok) kinds = r.kinds ?? kinds;
  return kinds;
}

/* ── Keeping the lines ──
   Drawing a connection and losing it on reload made every line feel provisional. The server
   stores them against each agent's conversation, so they come back after a reload, after a
   move, and after Herdr itself restarts. Saving is fire-and-forget on a short delay: drawing
   is a burst of small changes and each one does not need its own write. */
let pending = null;
let unsaved = false;                       // did the last write fail, and is that still true?

/** Write now instead of in a moment — for when something is about to read the lines back.
 *  It always writes: a timer id stays truthy after it has fired, so asking whether one is
 *  outstanding would be answering the wrong question, and the write costs one call. */
async function flush() {
  clearTimeout(pending);
  const r = await post('/api/wires', { wires: lines });
  if (r.ok) { groups = r.groups ?? groups; onSaved(); }
  else headMsg(`These lines are drawn on this page but not stored — ${r.error} Reloading would lose them.`);
}

function keep() {
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const r = await post('/api/wires', { wires: lines });
    if (r.ok) { groups = r.groups ?? groups; onSaved(); }
    // Fire-and-forget hid a real loss: the lines stayed on screen, the write had failed, and
    // the first sign of it was every line being gone after a reload. Say it while it can still
    // be fixed, and say what is actually true — drawn on this page, stored nowhere.
    if (!r.ok) {
      unsaved = true;
      headMsg(`These lines are drawn on this page but not stored — ${r.error} Reloading would lose them.`);
    } else if (unsaved) {
      unsaved = false;
      headMsg('The lines are stored again, so a reload keeps them.', { bad: false, forMs: 6000 });
    }
  }, 250);
}

/** Read back the lines drawn last time. Agents that are gone simply do not come back. */
export async function loadWires() {
  const r = await get('/api/wires');
  if (r.ok) { lines = r.wires ?? []; groups = r.groups ?? 0; }
  return lines;
}

/**
 * What to say once one job has gone out. The server counts three separate things — how many
 * agents took it, how many refused it, and how many are no longer running — and the view read
 * only the first, so an agent that never got the job looked exactly like one that did.
 * @param {{sent?:number, failed?:number, gone?:number}} r - the dispatch reply
 * @returns {{text:string, problem:string}} `text` is the running total to show beside the
 *   lines; `problem` is empty unless something did not happen, and is then what to do about it.
 */
export function sendOutcome({ sent = 0, failed = 0, gone = 0 } = {}) {
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  return {
    text: [
      `Sent to ${many(sent, 'agent', 'agents')}.`,
      failed ? `${many(failed, 'agent', 'agents')} would not take it.` : '',
      gone ? `${many(gone, 'connected agent is', 'connected agents are')} no longer running.` : '',
    ].filter(Boolean).join(' '),
    problem: failed
      ? `${many(failed, 'agent', 'agents')} did not get that job. Open ${failed === 1 ? 'it' : 'them'} and check ${failed === 1 ? 'it is' : 'they are'} sitting at a prompt, then send the job again.`
      : '',
  };
}

/**
 * Give every joined-up group the same job, each agent told its own part.
 *
 * The lines are read back from the server first, and that is the whole point. A line is stored
 * against two conversations and turned into two pane ids when it is fetched; the copy held here
 * was turned into pane ids ONCE, when the page loaded. Move or close a wired agent after that
 * and Herdr hands its pane to the next agent along, so sending the remembered pane ids would
 * type the brief into somebody else's work. Saving first, so nothing just drawn is lost, then
 * fetching, costs two calls at the one moment it matters.
 */
export async function sendJob(task) {
  return post('/api/connections/dispatch', { wires: lines, task });
}

/**
 * Save what is drawn, then read it back, so the lines and the group count are both resolved
 * against Herdr as it is right now rather than as it was when the page loaded.
 * @returns {{ok:true}|{ok:false, error:string}}
 */
export async function refreshWires() {
  await flush();
  await loadWires();
  return lines.length ? { ok: true } : { ok: false, error: 'None of the agents you joined up are still running.' };
}
