// Service layer: runs a saved flow step by step. Knows nothing about HTTP or the UI,
// and talks to Herdr only through the swap-seam in herdr.mjs.
import { getAgent, getSnapshot, runInPane, startAgent } from './herdr.mjs';
import { buildModel, listAgents } from './model.mjs';
import { resolveTarget } from './flows.mjs';

const runs = new Map();
let counter = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const splitArgv = (command) => command.trim().split(/\s+/);
const humanMs = (ms) => (ms < 90000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)} min`);

/** Newest first, so the UI can show what is running without knowing run ids. */
export const listRuns = () => [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);

export function stopRun(id) {
  const run = runs.get(id);
  if (!run || run.status !== 'running') return false;
  run.cancelled = true;
  return true;
}

/** Wait for a freshly spawned pane to report an agent state; send anyway once it times out. */
async function waitReady(bin, target, run, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !run.cancelled) {
    const status = (await getAgent(bin, target).catch(() => null))?.agent_status;
    if (status && status !== 'unknown') return true;
    await sleep(pollMs);
  }
  return false;
}

/**
 * Poll until the agent finishes the message it was just given.
 * `settleMs` covers the gap between sending and the agent flipping to "working".
 * An agent that never looks busy gets 'unsure', not 'idle' — it may be sitting on a
 * prompt (a first-run trust question, a menu) that swallowed the message.
 * @returns {'idle'|'unsure'|'blocked'|'timeout'|'stopped'}
 */
async function waitUntilDone(bin, target, run, { timeoutMs, settleMs, pollMs }) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let sawWorking = false;
  while (Date.now() < deadline) {
    if (run.cancelled) return 'stopped';
    await sleep(pollMs);
    const status = (await getAgent(bin, target).catch(() => null))?.agent_status;
    if (status === 'working') sawWorking = true;
    else if (status === 'blocked') return 'blocked';
    else if (status === 'idle' || status === 'done') {
      if (sawWorking) return 'idle';
      if (Date.now() - started > settleMs) return 'unsure';
    }
  }
  return 'timeout';
}

async function execute(bin, run, flow, limits) {
  for (const [i, step] of flow.steps.entries()) {
    const view = run.steps[i];
    if (run.cancelled) { view.state = 'skipped'; view.note = 'Stopped'; continue; }
    view.state = 'running';
    try {
      let target = null;
      if (step.spawn) {
        view.note = 'Starting a new agent…';
        target = await startAgent(bin, {
          label: step.spawn.label,
          cwd: step.spawn.cwd || undefined,
          workspaceId: step.spawn.workspaceId || undefined,
          split: step.spawn.split,
          argv: splitArgv(step.spawn.command),
        });
        view.target = target;
        const ready = await waitReady(bin, target, run, limits.spawnReadyMs, limits.pollMs);
        // A pane that never became an agent is a plain shell sitting at a prompt, and text
        // typed at a prompt is run, not read. Check the start command rather than send it.
        if (!ready) throw new Error(`Step ${i + 1} started a pane, but Herdr never reported an agent in it, so nothing was sent — check the start command.`);
        view.note = 'Agent is up.';
      } else {
        // Asked again for every step, not once per run: an agent can be moved between one step
        // and the next, and the pane a closed agent leaves behind is given to the next one.
        const snap = await getSnapshot(bin);
        if (!snap.ok) throw new Error(`Step ${i + 1} could not be sent — Herdr did not say which agents are running.`);
        const found = resolveTarget(step, listAgents(buildModel(snap.snapshot)), i + 1);
        if (!found.ok) throw new Error(found.error);
        target = found.target;
        view.target = target;
      }
      if (run.cancelled) { view.state = 'skipped'; view.note = 'Stopped'; continue; }

      if (step.text) await runInPane(bin, target, step.text);

      if (step.waitForIdle) {
        view.state = 'waiting';
        const outcome = await waitUntilDone(bin, target, run, limits);
        if (outcome === 'blocked') {
          view.state = 'blocked';
          view.note = 'This agent is asking you something — answer it, then run the rest.';
          run.status = 'blocked';
          return;
        }
        if (outcome === 'unsure') {
          view.state = 'unsure';
          view.note = 'Sent, but this agent never looked busy — open it and check it took the message.';
          run.status = 'unsure';
          return;
        }
        if (outcome === 'timeout') {
          view.state = 'failed';
          view.note = `Still busy after ${humanMs(limits.timeoutMs)} — stopping here.`;
          run.status = 'failed';
          return;
        }
        if (outcome === 'stopped') { view.state = 'skipped'; view.note = 'Stopped'; continue; }
      }
      view.state = 'done';
      view.note = step.waitForIdle ? 'Finished.' : 'Sent.';
    } catch (e) {
      view.state = 'failed';
      view.note = String(e.message || e);
      run.status = 'failed';
      return;
    }
  }
  run.status = run.cancelled ? 'stopped' : 'done';
}

/**
 * Kick off a flow. Returns immediately; poll listRuns() for progress.
 * @param {object} limits - {timeoutMs, settleMs, pollMs, spawnReadyMs, maxConcurrent}
 */
export function startRun(bin, flow, limits) {
  const active = [...runs.values()].filter((r) => r.status === 'running').length;
  if (active >= limits.maxConcurrent) throw new Error(`Already running ${active} workflows — let one finish first.`);

  const id = `run${++counter}`;
  const run = {
    id, flowId: flow.id, name: flow.name, status: 'running', cancelled: false, startedAt: Date.now(),
    steps: flow.steps.map((s, i) => ({
      n: i + 1,
      label: s.spawn ? `New agent · ${s.spawn.label}` : 'Agent',
      // Which pane it lands in is only known when the step runs — see resolveTarget.
      target: null,
      state: 'pending',
      note: '',
    })),
  };
  runs.set(id, run);
  // Keep the last few runs only — this is live progress, not history.
  for (const old of listRuns().slice(20)) runs.delete(old.id);
  execute(bin, run, flow, limits).catch((e) => {
    run.status = 'failed';
    run.error = String(e.message || e);
  });
  return run;
}
