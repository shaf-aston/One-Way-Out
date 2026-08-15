// Workflow manager: build a chain of agent steps, save it, run it, watch it run.
// A step = one agent (existing or freshly spawned) + one message. Steps run in order.
import { esc, get, post, autoGrow, attachPalette, agentsOf, confirmOnce, okToDiscard, onOverlayEscape } from './ui.js';
import { go } from './router.js';

let model = null;      // latest map model, so steps can pick real agents
let flows = [];        // saved workflows on disk
let presets = [];      // ready-made ones shipped with the app, so this is never a blank page
let draft = null;      // the workflow being edited
let runs = [];
let timer = null;
let pollMs = 1500;

export const setModel = (m) => { model = m; };
export const setPoll = (ms) => { pollMs = ms; };

const blankStep = () => ({ agentId: '', text: '', waitForIdle: true });
const blankFlow = () => ({ name: '', steps: [blankStep()] });
const cwdOf = (step) => step.spawn ? step.spawn.cwd : (agentsOf(model).find((a) => a.id === step.agentId)?.cwd ?? '');

/* ── Rendering ── */

function stepCard(step, i, runStep) {
  const agents = agentsOf(model);
  const spawning = !!step.spawn;
  const state = runStep?.state;
  return `<div class="step ${state ? `st-${state}` : ''}" data-i="${i}">
    <div class="step-top">
      <span class="step-n">${i + 1}</span>
      <span class="step-state ${state ? `s-${state}` : ''}" ${state ? '' : 'hidden'}>${esc(runStep?.note || state || '')}</span>
      <span class="step-tools">
        <button class="icon" data-act="left" title="Move earlier" ${i === 0 ? 'disabled' : ''}>←</button>
        <button class="icon" data-act="right" title="Move later">→</button>
        <button class="icon" data-act="remove" title="Remove step">✕</button>
      </span>
    </div>

    <label class="fld">
      <span>Agent</span>
      <select data-field="agentId">
        <option value="">— pick an agent —</option>
        ${agents.map((a) => `<option value="${esc(a.id)}" ${!spawning && step.agentId === a.id ? 'selected' : ''}>${esc(a.label)} · ${esc(a.workspace)}</option>`).join('')}
        <option value="__new" ${spawning ? 'selected' : ''}>＋ Start a new agent…</option>
      </select>
    </label>

    ${spawning ? `
      <div class="spawn">
        <label class="fld"><span>Name</span><input data-field="spawn.label" value="${esc(step.spawn.label)}" placeholder="reviewer" /></label>
        <label class="fld"><span>Command</span><input data-field="spawn.command" value="${esc(step.spawn.command)}" placeholder="claude" /></label>
        <label class="fld"><span>Folder</span><input data-field="spawn.cwd" value="${esc(step.spawn.cwd)}" placeholder="C:\\Users\\…\\project" /></label>
        <label class="fld"><span>Put it in</span>
          <select data-field="spawn.workspaceId">
            <option value="">a new pane beside the current one</option>
            ${(model?.workspaces ?? []).map((w) => `<option value="${esc(w.id)}" ${step.spawn.workspaceId === w.id ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}
          </select>
        </label>
      </div>` : ''}

    <label class="fld grow">
      <span>Message</span>
      <textarea data-field="text" rows="2" maxlength="4000" placeholder="Type a message, or / for a command…">${esc(step.text)}</textarea>
    </label>

    <label class="check">
      <input type="checkbox" data-field="waitForIdle" ${step.waitForIdle ? 'checked' : ''} />
      Wait for it to finish first
    </label>
  </div>`;
}

let startedId = null;  // the run this page kicked off, so an unsaved draft still shows progress

/** The run belonging to the workflow on screen, if there is one. */
const liveRun = () => runs.find((r) => r.id === startedId) ?? runs.find((r) => r.flowId === draft?.id) ?? null;

/** Progress only — never touches the fields, so it is safe to call while you type. */
function paint() {
  const sheet = document.querySelector('.flows');
  if (!sheet || !draft) return;
  const live = liveRun();
  sheet.querySelector('.run-line').textContent = live ? `${live.name} · ${live.status}` : '';
  sheet.querySelector('[data-act="stop"]').hidden = !(live && live.status === 'running');
  for (const card of sheet.querySelectorAll('.step')) {
    const rs = live?.steps?.[Number(card.dataset.i)];
    card.className = `step${rs?.state ? ` st-${rs.state}` : ''}`;
    const badge = card.querySelector('.step-state');
    if (badge) {
      badge.textContent = rs ? (rs.note || rs.state) : '';
      badge.className = `step-state${rs?.state ? ` s-${rs.state}` : ''}`;
      badge.hidden = !rs || rs.state === 'pending';
    }
  }
}

function render() {
  const sheet = document.querySelector('.flows');
  if (!sheet || !draft) return;
  const live = liveRun();

  sheet.querySelector('.flow-list').innerHTML =
    (flows.length
      ? `<p class="rail-k">Yours</p>` + flows.map((f) => `
          <button class="flow-pick ${draft.id === f.id ? 'on' : ''}" data-flow="${esc(f.id)}">
            <span>${esc(f.name)}</span><small>${f.steps.length} step${f.steps.length === 1 ? '' : 's'}</small>
          </button>`).join('')
      : '')
    + `<p class="rail-k">Ready-made — click to load a copy</p>`
    + presets.map((p, i) => `<button class="flow-pick preset" data-preset="${i}">
        <span>${esc(p.name)}</span><small>${esc(p.why)}</small>
      </button>`).join('');

  sheet.querySelector('.flow-name').value = draft.name;
  sheet.querySelector('.chain').innerHTML = draft.steps
    .map((s, i) => stepCard(s, i, live?.steps?.[i]))
    .join('<div class="link">→</div>')
    + `<div class="link">→</div><button class="add-step" data-act="add">＋ Add step</button>`;

  sheet.querySelector('[data-act="delete"]').hidden = !draft.id;
  // A step with no agent chosen has nobody to message, so Run would do nothing while
  // claiming otherwise. Say which step is missing instead of failing after the click.
  const unset = draft.steps.findIndex((s) => !s.spawn && !String(s.agentId ?? '').trim());
  const runBtn = sheet.querySelector('[data-act="run"]');
  runBtn.disabled = unset !== -1;
  runBtn.title = unset === -1 ? 'Run this workflow now' : `Step ${unset + 1} still needs an agent`;
  paint();

  for (const el of sheet.querySelectorAll('.chain textarea')) {
    autoGrow(el, 160);
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      attachPalette(el, () => cwdOf(draft.steps[Number(el.closest('.step').dataset.i)]));
    }
  }
}

/* ── Data ── */

async function loadFlows() {
  const r = await get('/api/flows');
  flows = r.ok ? r.flows : flows;
  presets = r.ok ? (r.presets ?? []) : presets;
  return r.ok ? null : r.error;
}

async function pollRuns() {
  const r = await get('/api/flows/runs');
  runs = r.ok ? r.runs : [];
  paint();
}

function toast(sheet, msg, bad = false) {
  const el = sheet.querySelector('.flow-msg');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

/* ── Open / close ── */

/** Unsaved = typed into, and different from whatever is on disk under that id. */
function dirty() {
  if (!draft) return false;
  const saved = flows.find((f) => f.id === draft.id);
  const typed = draft.name.trim() || draft.steps.some((s) => s.text.trim());
  return !!typed && JSON.stringify(saved ?? null) !== JSON.stringify(draft);
}

function closeFlows(force = false) {
  if (!force && !okToDiscard(dirty(), 'this unsaved workflow')) return false;
  clearInterval(timer);
  timer = null;
  document.querySelector('.flows-overlay')?.remove();
  return true;
}

export async function openFlows() {
  closeFlows(true);
  draft = blankFlow();
  await loadFlows();

  const ov = document.createElement('div');
  ov.className = 'overlay flows-overlay';
  ov.innerHTML = `<div class="sheet flows">
    <div class="sheet-head">
      <h3 class="display">Workflows</h3>
      <div class="actions">
        <span class="run-line" role="status" aria-live="polite"></span>
        <button class="btn" data-act="stop" hidden>Stop run</button>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="explainer">A workflow is a <b>relay</b>. Each box is one agent doing one thing;
      when it finishes, the next box starts. You are handing over a message you would otherwise
      type yourself — so if a step would confuse a person, it will confuse the agent.</p>
    <div class="flows-body">
      <aside class="flow-rail">
        <button class="btn wide" data-act="new">＋ New workflow</button>
        <div class="flow-list"></div>
      </aside>
      <section class="flow-edit">
        <label class="fld"><span>Workflow name</span>
          <input class="flow-name" maxlength="80" placeholder="Review then fix" />
        </label>
        <div class="chain"></div>
        <div class="flow-foot">
          <button class="btn primary" data-act="run">Run now</button>
          <button class="btn" data-act="save">Save</button>
          <button class="btn" data-act="delete" hidden>Delete</button>
          <span class="flow-msg" role="status" aria-live="polite"></span>
        </div>
      </section>
    </div>
    <div class="hintline">Type “/” in any message box to see the commands and skills this machine
      already has. Tick “wait” when the next agent needs the first one's answer; untick it to fire
      them off together.</div>
  </div>`;
  document.body.appendChild(ov);

  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return closeFlows();
    const pick = e.target.closest('[data-flow]');
    if (pick) {
      if (!okToDiscard(dirty(), 'this unsaved workflow')) return;
      draft = structuredClone(flows.find((f) => f.id === pick.dataset.flow)) || blankFlow();
      return render();
    }
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      if (!okToDiscard(dirty(), 'this unsaved workflow')) return;
      const p = presets[Number(preset.dataset.preset)];
      // A copy, with the agents left blank — you choose who does each step.
      draft = { name: p.name, steps: p.steps.map((s) => ({ agentId: '', text: s.text, waitForIdle: s.waitForIdle !== false })) };
      toast(ov, 'Loaded a copy. Pick which agent does each step, then Run or Save.');
      return render();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const i = Number(e.target.closest('.step')?.dataset.i ?? -1);

    if (act === 'close') return closeFlows();
    if (act === 'new') {
      if (!okToDiscard(dirty(), 'this unsaved workflow')) return;
      draft = blankFlow(); return render();
    }
    if (act === 'add') { draft.steps.push(blankStep()); return render(); }
    if (act === 'remove' && draft.steps.length > 1) { draft.steps.splice(i, 1); return render(); }
    if (act === 'left' && i > 0) { draft.steps.splice(i - 1, 0, draft.steps.splice(i, 1)[0]); return render(); }
    if (act === 'right' && i < draft.steps.length - 1) { draft.steps.splice(i + 1, 0, draft.steps.splice(i, 1)[0]); return render(); }
    if (act === 'save') {
      const r = await post('/api/flows/save', draft);
      if (!r.ok) return toast(ov, r.error, true);
      draft = structuredClone(r.flow);
      await loadFlows();
      toast(ov, 'Saved.');
      return render();
    }
    if (act === 'delete' && draft.id) {
      if (!confirmOnce(`Delete the workflow “${draft.name}”?`)) return;
      const r = await post('/api/flows/delete', { id: draft.id });
      if (!r.ok) return toast(ov, r.error, true);
      draft = blankFlow();
      await loadFlows();
      toast(ov, 'Deleted.');
      return render();
    }
    if (act === 'run') {
      const named = draft.steps.map((s, n) => `${n + 1}. ${s.spawn ? `new agent “${s.spawn.label}”` : (agentsOf(model).find((a) => a.id === s.agentId)?.label ?? 'an agent')}`).join('\n');
      if (!confirmOnce(`Run “${draft.name || 'this workflow'}” now?\n\nIt will message these agents in order:\n${named}`)) return;
      const r = await post('/api/flows/run', draft);
      if (!r.ok) return toast(ov, r.error, true);
      startedId = r.run.id;
      // A running workflow is watched where the agents are. Staying on this page to read
      // "Running…" is a dead end, so pressing Run takes you back to the map.
      closeFlows(true);
      go('sessions');
      return;
    }
    if (act === 'stop') {
      const live = liveRun();
      if (live) await post('/api/flows/stop', { id: live.id });
      return pollRuns();
    }
  });

  ov.addEventListener('input', (e) => {
    const el = e.target;
    if (el.classList.contains('flow-name')) { draft.name = el.value; return; }
    const field = el.dataset.field;
    if (!field) return;
    const step = draft.steps[Number(el.closest('.step').dataset.i)];
    if (field === 'agentId') {
      if (el.value === '__new') { delete step.agentId; step.spawn = { label:'agent', command:'claude', cwd:'', workspaceId:'', split:'right' }; }
      else { delete step.spawn; step.agentId = el.value; }
      return render();
    }
    if (field === 'waitForIdle') { step.waitForIdle = el.checked; return; }
    if (field.startsWith('spawn.')) { step.spawn[field.slice(6)] = el.value; return; }
    step[field] = el.value;
    if (el.tagName === 'TEXTAREA') autoGrow(el, 160);
  });

  render();
  await pollRuns();
  timer = setInterval(pollRuns, pollMs);
}

onOverlayEscape('.flows-overlay', closeFlows);
