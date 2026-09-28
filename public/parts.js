// Pieces more than one page draws: an employee card, an issue row, the budget bars, and the
// forms for issues, employees, goals and routines. One copy of each, so an issue looks and is
// edited the same way from the Dashboard, the board, and a goal.
import { esc, dialog, options, ask, ago, headMsg, basename } from './ui.js';
import { theState, act, employee, keyOf, liveOf, activeStaff, issueById } from './store.js';
import { go } from './router.js';

export const statusLabel = (id) => theState()?.vocab.statuses.find((s) => s.id === id)?.label ?? id;

const LIVE_WORDS = { working: 'working', blocked: 'asking you something', done: 'finished, idle', idle: 'idle' };

/** Budget bars — only for caps that are set. */
export const bars = (e) => (e.bars ?? []).map((b) => `<div class="bar ${b.fill >= 1 ? 'full' : b.fill >= 0.8 ? 'near' : ''}"
  title="${esc(b.label)}: ${b.used} of ${b.limit}"><span style="width:${Math.round(b.fill * 100)}%"></span><small>${esc(b.label)} ${b.used}/${b.limit}</small></div>`).join('');

/**
 * One employee as a card. A running one opens its agent when clicked (data-pane) — the same
 * viewer the Agents map uses; the buttons on it are its own.
 */
export function employeeCard(e, { actions = true } = {}) {
  const s = theState();
  const live = liveOf(e.id);
  const doing = s.issues.find((i) => i.assignee === e.id && i.status === 'in_progress');
  const boss = employee(e.reportsTo);
  const stateWord = e.state === 'active' ? (live ? LIVE_WORDS[live.status] ?? live.status : 'no agent yet') : e.state.replace('-', ' ');
  const tone = e.state !== 'active' ? 'idle' : live?.status === 'blocked' ? 'blocked' : live?.status === 'working' ? 'working' : live?.status === 'done' ? 'done' : 'idle';
  return `<article class="emp tone-${tone} st-${esc(e.state)}" ${live ? `data-pane="${esc(live.paneId)}" data-label="${esc(e.name)}" data-cwd="${esc(s.company.folder)}"` : ''} data-emp="${esc(e.id)}">
    <div class="emp-top">
      ${live ? `<button class="open name" title="Open ${esc(e.name)}'s agent">${esc(e.name)}</button>` : `<span class="name">${esc(e.name)}</span>`}
      <span class="model">${esc(e.model)}</span>
    </div>
    <div class="emp-title">${esc(e.title)}${boss ? ` · reports to ${esc(boss.name)}` : ''}</div>
    <div class="emp-state"><i class="swatch" style="background:var(--${tone})"></i>${esc(stateWord)}</div>
    ${doing ? `<a class="emp-doing" href="#/issues/${esc(doing.id)}">${esc(keyOf(doing))} ${esc(doing.title)}</a>` : ''}
    ${e.over ? `<p class="bad-note">Over budget: ${esc(e.over)}</p>` : ''}
    ${bars(e)}
    ${actions && e.state !== 'terminated' ? `<div class="emp-acts">
      ${e.state === 'active' ? `<button class="btn tiny" data-emp-act="wake" data-id="${esc(e.id)}" title="Check the queue now instead of at the next heartbeat">Wake</button>
        <button class="btn tiny" data-emp-act="pause" data-id="${esc(e.id)}">Pause</button>`
        : `<button class="btn tiny" data-emp-act="resume" data-id="${esc(e.id)}">Resume</button>`}
      <button class="btn tiny" data-emp-act="edit" data-id="${esc(e.id)}">Edit</button>
    </div>` : ''}
  </article>`;
}

/** Handle the buttons on employee cards, wherever they are drawn. */
export async function onEmployeeAction(e) {
  const b = e.target.closest('[data-emp-act]');
  if (!b) return false;
  const id = b.dataset.id;
  const who = employee(id);
  const verb = b.dataset.empAct;
  if (verb === 'edit') { await employeeForm(who); return true; }
  const r = await act(`employees/${verb}`, { id });
  if (r) headMsg(`${who?.name ?? id}: ${verb === 'wake' ? 'checking their queue now' : `${verb}d`}.`, { bad: false, forMs: 3000 });
  return true;
}

/** One issue as a row or a board card. */
export function issueCard(i, { draggable = false, compact = false } = {}) {
  const who = employee(i.assignee);
  const s = theState();
  const blocked = (i.blockedBy ?? []).map(issueById).filter((b) => b && !['done', 'cancelled'].includes(b.status));
  const kids = s.issues.filter((c) => c.parentId === i.id);
  const kidsDone = kids.filter((c) => c.status === 'done').length;
  return `<a class="issue p-${esc(i.priority)} s-${esc(i.status)}" href="#/issues/${esc(i.id)}" data-issue="${esc(i.id)}" ${draggable ? 'draggable="true"' : ''}>
    <span class="i-key">${esc(keyOf(i))}${i.kind === 'plan' ? ' · plan' : ''}</span>
    <span class="i-title">${esc(i.title)}</span>
    ${compact ? '' : `<span class="i-meta">
      ${who ? `<span class="who">${esc(who.name)}</span>` : '<span class="who none">unassigned</span>'}
      ${i.priority !== 'medium' ? `<span class="prio">${esc(i.priority)}</span>` : ''}
      ${blocked.length ? `<span class="waits" title="Waits for ${esc(blocked.map(keyOf).join(', '))}">waits on ${blocked.length}</span>` : ''}
      ${kids.length ? `<span class="kids">${kidsDone}/${kids.length} sub</span>` : ''}
      ${i.comments?.length ? `<span class="ncom">💬 ${i.comments.length}</span>` : ''}
    </span>`}
  </a>`;
}

/* ── Forms ── */
const staffOptions = (selected, blank = 'Nobody yet') => options([['', blank], ...activeStaff().map((e) => [e.id, `${e.name} — ${e.title}`])], selected);
const goalOptions = (selected) => options([['', 'No goal'], ...theState().goals.map((g) => [g.id, g.title])], selected);

/** Create or edit an issue. Returns the saved issue, or null. */
export async function issueForm(issue = null, preset = {}) {
  const s = theState();
  const i = { title: '', body: '', assignee: '', priority: 'medium', goalId: '', status: '', blockedBy: [], lane: [], ...preset, ...(issue ?? {}) };
  const others = s.issues.filter((x) => x.id !== i.id && !['done', 'cancelled'].includes(x.status));
  const r = await dialog({
    title: issue ? `Edit ${keyOf(issue)}` : 'New issue',
    wide: true,
    body: `<label class="fld"><span>Title</span><input name="title" maxlength="200" required autofocus value="${esc(i.title)}" placeholder="What needs doing, in a few words"></label>
      <label class="fld"><span>Details — written to whoever does it</span><textarea name="body" rows="5" maxlength="8000" placeholder="What done looks like, anything they need to know">${esc(i.body)}</textarea></label>
      <div class="fld-row">
        <label class="fld"><span>Assignee</span><select name="assignee">${staffOptions(i.assignee)}</select></label>
        <label class="fld"><span>Priority</span><select name="priority">${options(s.vocab.priorities.map((p) => [p, p]), i.priority)}</select></label>
        <label class="fld"><span>Goal</span><select name="goalId">${goalOptions(i.goalId)}</select></label>
      </div>
      <details class="more" ${i.blockedBy.length || i.lane.length ? 'open' : ''}><summary>Waits on, and files</summary>
        <label class="fld"><span>Waits on — it will not start until these are done</span>
          <select name="blockedBy" multiple size="${Math.min(6, Math.max(2, others.length))}">${others.map((o) =>
            `<option value="${esc(o.id)}" ${i.blockedBy.includes(o.id) ? 'selected' : ''}>${esc(keyOf(o))} ${esc(o.title)}</option>`).join('')}</select></label>
        <label class="fld"><span>Files only this issue may edit (comma separated)</span><input name="lane" value="${esc(i.lane.join(', '))}" placeholder="src/api/*.js, docs/api.md"></label>
      </details>
      ${issue ? '' : '<p class="muted-note">Assigned issues start at the assignee\'s next heartbeat while the company is running. Unassigned ones wait in the Backlog.</p>'}`,
    actions: [{ act: 'save', label: issue ? 'Save' : 'Create issue', primary: true }],
  });
  if (!r) return null;
  const blockedBy = r.values.blockedBy ?? [];
  const out = await act('issues', {
    id: issue?.id, title: r.values.title, body: r.values.body, assignee: r.values.assignee || null,
    priority: r.values.priority, goalId: r.values.goalId || null, blockedBy,
    lane: r.values.lane.split(',').map((x) => x.trim()).filter(Boolean),
    ...(issue ? {} : { parentId: preset.parentId ?? null }),
  });
  if (out) headMsg(issue ? 'Saved.' : `${keyOf(out.issue)} created.`, { bad: false, forMs: 3000 });
  return out?.issue ?? null;
}

/** Hire someone new, or change an employee's role. `bindPane` hires an agent already running. */
export async function employeeForm(e = null, { bindPane = null, name = '' } = {}) {
  const s = theState();
  const x = { name, title: '', job: '', reportsTo: '', model: 'sonnet', everyMin: 0, budget: {}, ...(e ?? {}) };
  const boss = s.employees.filter((o) => o.id !== x.id && o.state !== 'terminated');
  const r = await dialog({
    title: e ? `Edit ${e.name}` : bindPane ? 'Hire this agent' : 'Hire',
    wide: true,
    body: `<div class="fld-row">
        <label class="fld"><span>Name</span><input name="name" maxlength="40" required autofocus value="${esc(x.name)}"></label>
        <label class="fld"><span>Title</span><input name="title" maxlength="60" value="${esc(x.title)}" placeholder="Engineer"></label>
      </div>
      <label class="fld"><span>Job description — every brief they get starts with this</span>
        <textarea name="job" rows="3" maxlength="2000" placeholder="What they are responsible for">${esc(x.job)}</textarea></label>
      <div class="fld-row">
        <label class="fld"><span>Reports to</span><select name="reportsTo">${options([['', 'The board (you)'], ...boss.map((o) => [o.id, `${o.name} — ${o.title}`])], x.reportsTo)}</select></label>
        <label class="fld"><span>Model</span><select name="model">${options(s.vocab.models.map((m) => [m, m]), x.model)}</select></label>
        <label class="fld"><span>Heartbeat</span><select name="everyMin">${options([[0, 'As soon as work is assigned'], [5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [60, 'Every hour'], [240, 'Every 4 hours'], [1440, 'Once a day']], x.everyMin)}</select></label>
      </div>
      <fieldset class="budget"><legend>Budget — 0 means no cap. Hitting one pauses them and asks you.</legend>
        <div class="fld-row">
          <label class="fld"><span>Issues a day</span><input name="tasksPerDay" type="number" min="0" value="${x.budget.tasksPerDay ?? 0}"></label>
          <label class="fld"><span>Minutes of work a day</span><input name="activeMinPerDay" type="number" min="0" value="${x.budget.activeMinPerDay ?? 0}"></label>
          <label class="fld"><span>Tokens a month</span><input name="tokensPerMonth" type="number" min="0" step="1000" value="${x.budget.tokensPerMonth ?? 0}"></label>
        </div>
      </fieldset>
      ${e && e.state !== 'terminated' ? '<p class="muted-note">Letting someone go closes their agent and puts their open issues back in the Backlog.</p>' : ''}`,
    actions: [
      ...(e && e.state !== 'terminated' ? [{ act: 'terminate', label: 'Let go…', danger: true }] : []),
      { act: 'save', label: e ? 'Save' : 'Hire', primary: true },
    ],
  });
  if (!r) return null;
  if (r.act === 'terminate') {
    if (!await ask(`Let ${e.name} go?`, { yes: 'Let go', danger: true, detail: 'Their agent is closed and their open issues go back to the Backlog. Their reports move up to their manager.' })) return null;
    return act('employees/terminate', { id: e.id });
  }
  const v = r.values;
  const out = await act('employees', {
    id: e?.id, name: v.name, title: v.title, job: v.job, reportsTo: v.reportsTo || null, model: v.model, everyMin: Number(v.everyMin),
    budget: { tasksPerDay: Number(v.tasksPerDay), activeMinPerDay: Number(v.activeMinPerDay), tokensPerMonth: Number(v.tokensPerMonth) },
    bindPane,
  });
  if (out) headMsg(e ? 'Saved.' : `${out.employee.name} hired.`, { bad: false, forMs: 3000 });
  return out;
}

export async function goalForm(g = null, { parentId = null } = {}) {
  const s = theState();
  const x = { title: '', detail: '', parentId, done: false, ...(g ?? {}) };
  const r = await dialog({
    title: g ? 'Edit goal' : 'New goal',
    body: `<label class="fld"><span>Goal</span><input name="title" maxlength="120" required autofocus value="${esc(x.title)}" placeholder="e.g. Launch the public beta"></label>
      <label class="fld"><span>What it means — the CEO reads this when planning it</span><textarea name="detail" rows="4" maxlength="1000">${esc(x.detail)}</textarea></label>
      <label class="fld"><span>Part of</span><select name="parentId">${options([['', 'The mission'], ...s.goals.filter((o) => o.id !== x.id).map((o) => [o.id, o.title])], x.parentId)}</select></label>
      ${g ? `<label class="check"><input type="checkbox" name="done" ${x.done ? 'checked' : ''}> Achieved</label>` : ''}`,
    actions: [...(g ? [{ act: 'delete', label: 'Delete', danger: true }] : []), { act: 'save', label: g ? 'Save' : 'Add goal', primary: true }],
  });
  if (!r) return null;
  if (r.act === 'delete') return (await ask(`Delete “${g.title}”?`, { yes: 'Delete', danger: true, detail: 'Issues under it stay; they just lose the link.' })) ? act('goals/delete', { id: g.id }) : null;
  return act('goals', { id: g?.id, title: r.values.title, detail: r.values.detail, parentId: r.values.parentId || null, done: !!r.values.done });
}

export async function routineForm(rt = null) {
  const s = theState();
  const x = { title: '', body: '', assignee: '', schedule: { kind: 'daily', at: '09:00', everyMin: 60 }, enabled: true, ...(rt ?? {}) };
  const r = await dialog({
    title: rt ? 'Edit routine' : 'New routine',
    wide: true,
    body: `<label class="fld"><span>Title — each issue it creates is called this</span><input name="title" maxlength="120" required autofocus value="${esc(x.title)}" placeholder="e.g. Morning dependency check"></label>
      <label class="fld"><span>Details</span><textarea name="body" rows="3" maxlength="4000">${esc(x.body)}</textarea></label>
      <div class="fld-row">
        <label class="fld"><span>Assignee</span><select name="assignee">${staffOptions(x.assignee, 'Nobody — goes to the Backlog')}</select></label>
        <label class="fld"><span>Repeats</span><select name="kind">${options([['daily', 'Every day at'], ['weekdays', 'Weekdays at'], ['every', 'Every N minutes']], x.schedule.kind)}</select></label>
        <label class="fld"><span>Time</span><input name="at" type="time" value="${esc(x.schedule.at ?? '09:00')}"></label>
        <label class="fld"><span>Minutes</span><input name="everyMin" type="number" min="5" value="${x.schedule.everyMin ?? 60}"></label>
      </div>
      <label class="check"><input type="checkbox" name="enabled" ${x.enabled ? 'checked' : ''}> On</label>`,
    actions: [...(rt ? [{ act: 'delete', label: 'Delete', danger: true }] : []), { act: 'save', label: rt ? 'Save' : 'Add routine', primary: true }],
  });
  if (!r) return null;
  if (r.act === 'delete') return (await ask(`Delete the routine “${rt.title}”?`, { yes: 'Delete', danger: true })) ? act('routines/delete', { id: rt.id }) : null;
  const v = r.values;
  return act('routines', { id: rt?.id, title: v.title, body: v.body, assignee: v.assignee || null, enabled: v.enabled,
    schedule: { kind: v.kind, at: v.at, everyMin: Number(v.everyMin) } });
}

/** Ask the top of the company to plan a goal (or any text) into issues. */
export async function planGoal(goalId = null) {
  const s = theState();
  const top = s.employees.find((e) => !e.reportsTo && e.state === 'active');
  if (!top) return headMsg('Nobody is active at the top of the company to plan it. Hire or resume a CEO first.');
  let text = '';
  if (!goalId) {
    const r = await dialog({ title: `What should ${top.name} plan?`,
      body: `<label class="fld"><span>Describe the outcome you want</span><textarea name="text" rows="4" autofocus required maxlength="2000"></textarea></label>`,
      actions: [{ act: 'plan', label: 'Plan it', primary: true }] });
    if (!r?.values.text.trim()) return null;
    text = r.values.text;
  }
  const out = await act('plan', { goalId, text });
  if (!out) return null;
  headMsg(s.company.running
    ? `${top.name} is planning it as ${keyOf(out.issue)}. The plan comes to your Inbox.`
    : `${keyOf(out.issue)} is waiting for ${top.name}. Press Run company to start.`, { bad: false, forMs: 7000 });
  return out;
}

export const folderName = (p) => basename(p);
export { ago, go };
