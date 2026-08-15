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
      const agentId = String(s?.agentId ?? '').trim();
      if (!agentId) return { ok: false, error: `${at}: pick an agent, or set it to spawn a new one.` };
      if (!isValidPaneId(agentId)) return { ok: false, error: `${at}: that agent id looks wrong.` };
      step.agentId = agentId;
    }
    if (!step.text && !step.spawn) return { ok: false, error: `${at}: type the message to send.` };
    steps.push(step);
  }
  return { ok: true, flow: { id, name, steps } };
}
