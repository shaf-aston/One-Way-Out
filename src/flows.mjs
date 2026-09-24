// Saved workflows: pure validation. The JSON files themselves live in store.mjs.
// A flow is an ordered list of steps; each step targets an existing agent or spawns a new
// one, sends it some text, and (optionally) waits for it to go idle before the next step.
import path from 'node:path';
import { isValidPaneId, isValidId, slugify } from './ids.mjs';

const MAX_STEPS = 20;
const MAX_TEXT = 4000;

/**
 * Normalize and check a flow coming from the browser (trust boundary).
 * @returns {{ok:true, flow:object}|{ok:false, error:string}}
 */
export function validateFlow(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) return { ok: false, error: 'Give the workflow a name.' };
  if (name.length > 80) return { ok: false, error: 'Name is too long (80 characters max).' };
  const id = slugify(name);
  if (!isValidId(id)) return { ok: false, error: 'Name needs at least one letter or number.' };

  const rawSteps = Array.isArray(input?.steps) ? input.steps : [];
  if (!rawSteps.length) return { ok: false, error: 'Add at least one step.' };
  if (rawSteps.length > MAX_STEPS) return { ok: false, error: `Too many steps (${MAX_STEPS} max).` };

  const steps = [];
  for (const [i, s] of rawSteps.entries()) {
    const at = `Step ${i + 1}`;
    const text = String(s?.text ?? '').slice(0, MAX_TEXT);
    const step = { text, waitForIdle: s?.waitForIdle !== false };
    if (s?.spawn) {
      const command = String(s.spawn.command ?? '').trim();
      const cwd = String(s.spawn.cwd ?? '').trim();
      if (!command) return { ok: false, error: `${at}: what command starts the new agent? (e.g. claude)` };
      if (command.length > 200) return { ok: false, error: `${at}: start command is too long.` };
      if (cwd && !path.isAbsolute(cwd)) return { ok: false, error: `${at}: folder must be a full path.` };
      step.spawn = {
        label: String(s.spawn.label ?? '').trim().slice(0, 40) || 'agent',
        command, cwd,
        workspaceId: String(s.spawn.workspaceId ?? '').trim().slice(0, 64),
        split: ['right', 'down'].includes(s.spawn.split) ? s.spawn.split : 'right',
      };
    } else {
      // The conversation, never the pane it happens to sit in — see "Which pane a step means".
      const session = String(s?.session ?? '').trim();
      if (!session) return { ok: false, error: `${at}: pick an agent, or set it to spawn a new one.` };
      if (!isValidPaneId(session)) return { ok: false, error: `${at}: that agent id looks wrong.` };
      step.session = session;
    }
    if (!step.text && !step.spawn) return { ok: false, error: `${at}: type the message to send.` };
    steps.push(step);
  }
  return { ok: true, flow: { id, name, steps } };
}

/* ── Which pane a step means ──
   A pane id is where an agent sits right now. Moving one reassigns it (src/moves.mjs does that
   on purpose), and closing an agent hands its slot to whoever opens next, so a workflow saved
   on Monday could otherwise type its message into a different agent doing real work on Friday.
   A step is therefore written against the conversation, and turned back into a pane the moment
   it is about to be sent — the same rule the drawn lines use (toSaved/fromSaved in org.mjs). */

/**
 * The pane the step's agent is in right now.
 * There is deliberately no fallback to a remembered pane id: sending to the wrong live agent is
 * worse than sending nothing, so a step whose agent has gone stops the run and says so.
 * @param {object} step - one step from a validated flow
 * @param {Array<{id:string, session:string}>} agents - the agents running right now
 * @param {number} n - which step this is, counting from 1, for the sentence a person reads
 * @returns {{ok:true, target:string}|{ok:false, error:string}}
 */
export function resolveTarget(step, agents = [], n = 1) {
  const session = step?.session;
  if (!session) return { ok: false, error: `Step ${n} does not say which agent it was for, so nothing was sent. Open the workflow, pick its agent again, and save it.` };
  const now = (Array.isArray(agents) ? agents : []).filter((a) => a.session === session);
  if (!now.length) return { ok: false, error: `Step ${n} was for an agent that is no longer running, so nothing was sent.` };
  // Resuming a conversation while its first pane is still open puts the same conversation in
  // two places. Picking one of them would be a guess, and this is the one place that must not.
  if (now.length > 1) return { ok: false, error: `Step ${n} matches ${now.length} agents having the same conversation, so nothing was sent. Close one of them, or pick the agent again.` };
  return { ok: true, target: now[0].id };
}
