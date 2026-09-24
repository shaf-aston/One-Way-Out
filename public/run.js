// A run: one goal, split by a planner agent into a plan you approve before anything else
// starts. The tree of tasks is shown the same way #/org shows a chain of command — same
// tiersOf, same row shape — because a proposed plan and a drawn org are the same kind of
// picture, just one of them has not happened yet.
import { esc, get, post, autoGrow, confirmOnce, onOverlayEscape } from './ui.js';
import { tiersOf } from './tiers.js';
import { lanesClash, tasksToWires } from './plan.js';

const MODELS = ['opus', 'sonnet', 'haiku'];

let runId = null;
let run = null;     // the latest /api/run/status result
let tasks = null;   // an editable copy of run.plan.tasks, once the plan is ready
let timer = null;
let pollMs = 1500;
let ov = null;

export const setPoll = (ms) => { pollMs = ms; };

/** Close means close, and nothing else — navigating away is index.html's job, same as #/org. */
const closeRun = () => {
  clearInterval(timer);
  timer = null;
  document.querySelector('.run-overlay')?.remove();
};

function toast(msg, bad = false) {
  const el = ov.querySelector('.run-msg');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

function showPhase(name) {
  for (const n of ['goal', 'planning', 'blocked', 'ready', 'live']) ov.querySelector(`.run-${n}`).hidden = n !== name;
}

const TASK_STATE = {
  working: 'Working',
  rolling: 'Reading its team’s results, writing one merged summary',
  done: 'Done',
  unsure: 'Finished, but never wrote its result — worth a look',
  failed: 'Failed to start',
};

/** What each row of the proposed tree is called, in plain words rather than a rank number. */
function rowName(i, total) {
  if (i === 0) return total === 1 ? 'Does the work' : 'Leads';
  if (i === 1) return 'Reports to it';
  return `${i} steps down`;
}

function taskCard(t) {
  const others = tasks.filter((o) => o.id !== t.id);
  const pick = (field, none) => `<option value="">${esc(none)}</option>${others.map((o) =>
    `<option value="${esc(o.id)}" ${t[field] === o.id ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}`;
  return `<div class="card task-card" data-task="${esc(t.id)}">
    <div class="top">
      <input class="task-title" data-field="title" value="${esc(t.title)}" aria-label="Task title" />
      <button class="icon" data-remove="${esc(t.id)}" title="Remove this task" aria-label="Remove this task">✕</button>
    </div>
    <label class="fld"><span>What it does</span>
      <textarea data-field="brief" rows="2">${esc(t.brief)}</textarea>
    </label>
    <div class="task-row">
      <label class="fld small"><span>Model</span>
        <select data-field="model">${MODELS.map((m) =>
          `<option value="${m}" ${t.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </label>
      <label class="fld small"><span>Led by</span>
        <select data-field="parent">${pick('parent', 'nobody — top of the tree')}</select>
      </label>
      <label class="fld small"><span>Picks up from</span>
        <select data-field="after">${pick('after', 'nothing — starts right away')}</select>
      </label>
    </div>
    <label class="fld small"><span>Files it alone may edit</span>
      <input data-field="lane" value="${esc((t.lane ?? []).join(', '))}" placeholder="e.g. src/pages/**" />
    </label>
  </div>`;
}

function paintClashes() {
  const box = ov.querySelector('.plan-clashes');
  const clashes = lanesClash({ tasks });
  if (!clashes.length) { box.hidden = true; return; }
  const byId = new Map(tasks.map((t) => [t.id, t.title]));
  box.hidden = false;
  box.innerHTML = clashes.map((c) =>
    `<p>${esc(c.file)} is claimed by more than one task: ${c.taskIds.map((id) => esc(byId.get(id) ?? id)).join(' and ')}.
      Give it one owner and tell the others to message that one instead.</p>`).join('');
}

function paintChart() {
  const chart = ov.querySelector('.plan-chart');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { tiers, loose } = tiersOf(tasksToWires({ tasks }), tasks.map((t) => t.id));

  const rows = tiers.map((ids, i) => `<div class="org-row">
      <p class="org-rank">${esc(rowName(i, tiers.length))}</p>
      <div class="org-cards">${ids.map((id) => taskCard(byId.get(id))).join('')}</div>
    </div>`).join('');
  const rest = loose.length ? `<div class="org-row ${tiers.length ? 'loose' : ''}">
      <p class="org-rank">${tiers.length ? 'Not connected' : 'Tasks'}</p>
      <div class="org-cards">${loose.map((id) => taskCard(byId.get(id))).join('')}</div>
    </div>` : '';

  chart.innerHTML = rows + rest || '<p class="muted-note">No tasks left — nothing would run.</p>';
  for (const el of chart.querySelectorAll('textarea')) autoGrow(el, 160);
  paintClashes();
}

function paintLive() {
  const box = ov.querySelector('.run-live-tasks');
  const byId = new Map((run.plan?.tasks ?? []).map((t) => [t.id, t]));
  const entries = Object.entries(run.tasks ?? {});
  box.innerHTML = entries.map(([id, t]) => `<div class="card task-live st-${esc(t.state)}">
      <div class="top"><span class="name">${esc(byId.get(id)?.title ?? id)}</span></div>
      <div class="task-live-state">${esc(TASK_STATE[t.state] ?? t.state)}</div>
      ${t.error ? `<div class="bad-note">${esc(t.error)}</div>` : ''}
    </div>`).join('') || '<p class="muted-note">No tasks started.</p>';
  const left = entries.filter(([, t]) => t.state === 'working' || t.state === 'rolling').length;
  ov.querySelector('.run-live-note').textContent = left
    ? `${left} of ${entries.length} still working.`
    : 'Every task has finished, failed to start, or is worth a look.';
}

async function pollLive() {
  const r = await get(`/api/run/status?id=${encodeURIComponent(runId)}`);
  if (!r.ok) { clearInterval(timer); timer = null; toast(r.error, true); return; }
  run = r.run;
  paintLive();
}

async function poll() {
  const r = await get(`/api/run/status?id=${encodeURIComponent(runId)}`);
  if (!r.ok) { clearInterval(timer); timer = null; toast(r.error, true); return; }
  run = r.run;
  if (run.status === 'planning') return; // still waiting — stay on the planning phase

  clearInterval(timer);
  timer = null;
  if (run.status === 'needs-you') {
    ov.querySelector('.run-blocked .bad-note').textContent =
      `The planner could not write a usable plan: ${run.planError}`;
    ov.querySelector('.run-raw').textContent = run.planRaw ?? '';
    return showPhase('blocked');
  }
  tasks = run.plan.tasks.map((t) => ({ ...t, lane: [...(t.lane ?? [])] }));
  showPhase('ready');
  paintChart();
}

async function startPlanning() {
  const goal = ov.querySelector('.run-goal-text').value.trim();
  const folder = ov.querySelector('.run-folder').value.trim();
  if (!goal || !folder) return toast('Type a goal and a folder first.', true);
  toast('');
  const r = await post('/api/run/plan', { goal, folder });
  if (!r.ok) return toast(r.error, true);
  runId = r.id;
  showPhase('planning');
  poll();
  timer = setInterval(poll, pollMs);
}

export async function openRun() {
  closeRun();
  runId = null; run = null; tasks = null;

  ov = document.createElement('div');
  ov.className = 'overlay run-overlay';
  ov.innerHTML = `<div class="sheet run">
    <div class="sheet-head">
      <h3 class="display">New run</h3>
      <div class="actions">
        <span class="flow-msg run-msg" role="status" aria-live="polite"></span>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="explainer">Type one goal. A planner agent reads your folder and splits it into
      tasks for a team of agents — <b>nothing starts until you approve the plan</b>, and every
      part of it can be changed first.</p>

    <div class="run-goal">
      <label class="fld"><span>Goal</span>
        <textarea class="run-goal-text" rows="2" maxlength="2000" placeholder="What should the team build?"></textarea>
      </label>
      <label class="fld"><span>Or type the folder's full path</span>
        <input class="run-folder" placeholder="C:\\Users\\…\\project" />
      </label>
      <div class="folder-list">Reading your folders…</div>
      <button class="btn primary" data-act="plan">Plan it</button>
    </div>

    <div class="run-planning" hidden>
      <p class="muted-note">Planning — the planner agent is reading the folder and splitting
        the goal into tasks. This usually takes under a minute.</p>
    </div>

    <div class="run-blocked" hidden>
      <p class="bad-note"></p>
      <pre class="run-raw"></pre>
      <button class="btn" data-act="restart">Start over</button>
    </div>

    <div class="run-ready" hidden>
      <div class="plan-clashes bad-note" hidden></div>
      <div class="plan-chart"></div>
      <div class="flow-foot">
        <button class="btn primary" data-act="approve">Approve &amp; run</button>
        <span class="muted-note">Starts every task's own agent — nothing runs until you press this.</span>
      </div>
    </div>

    <div class="run-live" hidden>
      <p class="muted-note run-live-note"></p>
      <div class="org-cards run-live-tasks"></div>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const r = await get('/api/projects');
  const list = ov.querySelector('.folder-list');
  const folderBox = ov.querySelector('.run-folder');
  list.innerHTML = r.ok && r.projects.length
    ? r.projects.map((p) => `<button class="chip" data-folder="${esc(p.path)}" title="${esc(p.path)}">
        ${esc(p.name)}${p.running ? ' <small>running</small>' : ''}</button>`).join('')
    : `<p class="muted-note">${r.ok ? 'No project folders found — type a path above.' : esc(r.error)}</p>`;

  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return closeRun();
    const folder = e.target.closest('[data-folder]')?.dataset.folder;
    if (folder) {
      folderBox.value = folder;
      for (const c of ov.querySelectorAll('[data-folder]')) c.classList.toggle('picked', c.dataset.folder === folder);
      return;
    }
    const rm = e.target.closest('[data-remove]')?.dataset.remove;
    if (rm) {
      tasks = tasks.filter((t) => t.id !== rm);
      for (const t of tasks) {
        if (t.parent === rm) t.parent = null;
        if (t.after === rm) t.after = null;
      }
      return paintChart();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return closeRun();
    if (act === 'plan') return startPlanning();
    if (act === 'restart') { runId = null; run = null; return showPhase('goal'); }
    if (act === 'approve') {
      if (!tasks.length) return toast('There is nothing left to run.', true);
      if (!confirmOnce(`Start ${tasks.length} agent${tasks.length === 1 ? '' : 's'} for this plan? Each begins working right away.`)) return;
      const out = await post('/api/run/approve', { id: runId, plan: { ...run.plan, tasks } });
      if (!out.ok) return toast(out.error, true);
      run = out.run;
      showPhase('live');
      paintLive();
      clearInterval(timer);
      timer = setInterval(pollLive, pollMs);
    }
  });

  ov.addEventListener('input', (e) => {
    const el = e.target;
    if (el === ov.querySelector('.run-goal-text') || el === folderBox) return;
    const card = el.closest('[data-task]');
    if (!card || !tasks) return;
    const t = tasks.find((x) => x.id === card.dataset.task);
    if (!t) return;
    const {field} = el.dataset;
    if (field === 'lane') { t.lane = el.value.split(',').map((s) => s.trim()).filter(Boolean); return paintClashes(); }
    if (field === 'parent' || field === 'after') { t[field] = el.value || null; return paintChart(); }
    t[field] = el.value;
    if (field === 'brief') autoGrow(el, 160);
  });

  for (const el of ov.querySelectorAll('.run-goal-text')) autoGrow(el, 160);
  ov.querySelector('.run-goal-text').focus();
}

onOverlayEscape('.run-overlay', closeRun);
