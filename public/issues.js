// Issues — every piece of work. The board is one column per status; drag a card to move it.
// `#/issues/<id>` is one issue: why it exists, who has it, what they wrote back, and the thread.
import { esc, get, ask, dialog, headMsg, ago } from './ui.js';
import { act, cid, employee, keyOf, liveOf, issueById, activeStaff } from './store.js';
import { issueCard, issueForm, statusLabel } from './parts.js';
import { feedLine } from './dashboard.js';
import { go } from './router.js';

// Filters live for the session, not in the URL: they are a way of looking, not a place.
const filter = { who: '', goal: '', q: '', closed: false };

export const newIssue = (preset) => issueForm(null, preset);

export function draw(el, s, arg) {
  if (arg) return drawOne(el, s, arg);
  const cols = s.vocab.statuses.filter((c) => filter.closed || c.id !== 'cancelled');
  const q = filter.q.toLowerCase();
  const shown = s.issues.filter((i) => (!filter.who || (filter.who === '-' ? !i.assignee : i.assignee === filter.who))
    && (!filter.goal || i.goalId === filter.goal)
    && (!q || `${keyOf(i)} ${i.title} ${i.body}`.toLowerCase().includes(q)));
  const staff = activeStaff();
  el.innerHTML = `<div class="page-head"><h2 class="display">Issues</h2>
      <div class="actions"><button class="btn primary" data-act="new" title="C">＋ Issue</button></div></div>
    <form class="quick-add" data-quick>
      <input name="title" maxlength="200" placeholder="Quick add — type a title and press Enter" aria-label="New issue title">
      <select name="assignee" aria-label="Assign to">${[['', 'Unassigned'], ...staff.map((e) => [e.id, e.name])]
        .map(([v, t]) => `<option value="${esc(v)}" ${v === (filter.who && filter.who !== '-' ? filter.who : '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <button class="btn">Add</button>
    </form>
    <div class="filters">
      <select data-filter="who" aria-label="Whose issues">${[['', 'Everyone'], ['-', 'Unassigned'], ...staff.map((e) => [e.id, e.name])]
        .map(([v, t]) => `<option value="${esc(v)}" ${v === filter.who ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <select data-filter="goal" aria-label="Which goal">${[['', 'Every goal'], ...s.goals.map((g) => [g.id, g.title])]
        .map(([v, t]) => `<option value="${esc(v)}" ${v === filter.goal ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <input type="search" data-filter="q" value="${esc(filter.q)}" placeholder="Search" aria-label="Search issues">
      <label class="check"><input type="checkbox" data-filter="closed" ${filter.closed ? 'checked' : ''}> Show cancelled</label>
      ${s.clashes.length ? `<span class="tag warn" title="${esc(s.clashes.map((c) => `${c.file}: ${c.issueIds.map((id) => keyOf(issueById(id))).join(', ')}`).join('\n'))}">⚠ ${s.clashes.length} file${s.clashes.length === 1 ? '' : 's'} claimed twice</span>` : ''}
    </div>
    <div class="kanban">${cols.map((c) => {
      const list = shown.filter((i) => i.status === c.id).sort((a, b) => b.updatedAt - a.updatedAt);
      return `<section class="kcol k-${esc(c.id)}" data-col="${esc(c.id)}" title="${esc(c.blurb)}">
        <h3>${esc(c.label)} <span class="badge">${list.length}</span></h3>
        <div class="kcards">${list.map((i) => issueCard(i, { draggable: true })).join('') || '<p class="col-none">—</p>'}</div>
      </section>`;
    }).join('')}</div>`;
}

/* ── One issue ── */
let detail = { id: null, stamp: null, data: null };

function drawOne(el, s, id) {
  const i = issueById(id);
  if (!i) { el.innerHTML = '<div class="state"><p>That issue does not exist any more.</p><a class="btn" href="#/issues">All issues</a></div>'; return; }
  const who = employee(i.assignee);
  const live = who ? liveOf(who.id) : null;
  const parent = issueById(i.parentId);
  const kids = s.issues.filter((c) => c.parentId === i.id);
  const waits = (i.blockedBy ?? []).map(issueById).filter(Boolean);
  const goal = s.goals.find((g) => g.id === i.goalId);
  const stamp = `${i.id}:${i.updatedAt}:${i.status}`;
  if (detail.id !== i.id || detail.stamp !== stamp) {
    detail = { id: i.id, stamp, data: detail.id === i.id ? detail.data : null };
    get(`/api/c/${cid()}/issue?id=${encodeURIComponent(i.id)}`).then((r) => {
      if (!r.ok || detail.id !== i.id) return;
      detail.data = r;
      const box = document.querySelector('[data-extra]');
      if (box) box.innerHTML = extra(r);
    });
  }
  const sel = (name, rows, value) => `<select data-field="${name}" aria-label="${name}">${rows.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="page-head issue-head">
      <div><a class="crumb" href="#/issues">Issues</a>${parent ? ` / <a class="crumb" href="#/issues/${esc(parent.id)}">${esc(keyOf(parent))}</a>` : ''}
        <h2 class="display"><span class="i-key">${esc(keyOf(i))}</span> ${esc(i.title)}</h2></div>
      <div class="actions">
        ${i.status === 'in_review' ? '<button class="btn primary" data-act="accept">Accept</button><button class="btn" data-act="changes">Request changes</button>' : ''}
        ${['todo', 'backlog', 'blocked'].includes(i.status) && i.assignee ? '<button class="btn primary" data-act="start" title="Hand it to its assignee now">Start now</button>' : ''}
        ${['done', 'cancelled', 'blocked', 'in_review'].includes(i.status) ? '<button class="btn" data-act="reopen">Reopen</button>' : ''}
        ${live ? `<button class="btn open" data-pane="${esc(live.paneId)}" data-label="${esc(who.name)}" data-cwd="${esc(s.company.folder)}">Open ${esc(who.name)}'s agent</button>` : ''}
        <button class="btn" data-act="edit">Edit</button>
      </div>
    </div>
    <div class="issue-grid">
      <div class="issue-main">
        ${i.body ? `<div class="issue-body">${esc(i.body)}</div>` : '<p class="muted-note">No details. <button class="btn tiny" data-act="edit">Add some</button></p>'}
        ${kids.length ? `<h4>Sub-issues</h4>${kids.map((k) => issueCard(k)).join('')}` : ''}
        <p><button class="btn tiny" data-act="sub">＋ Sub-issue</button></p>
        <div data-extra>${detail.data ? extra(detail.data) : ''}</div>
        <h4>Discussion</h4>
        <ul class="thread">${(i.comments ?? []).map((c) => `<li class="c-${c.by === 'you' ? 'you' : c.by === 'system' ? 'sys' : 'agent'}">
          <b>${esc(c.by === 'you' ? 'You' : c.by === 'system' ? 'Heartbeat' : employee(c.by)?.name ?? c.by)}</b>
          <span class="when">${esc(ago(c.at))}</span><p>${esc(c.text)}</p></li>`).join('') || '<li class="muted-note">No comments yet.</li>'}</ul>
        <form class="comment" data-comment>
          <textarea name="text" rows="2" maxlength="4000" placeholder="${i.status === 'in_progress' && live ? `Write to ${esc(who.name)} — it reaches their agent straight away` : 'Add a note'}"></textarea>
          <button class="btn primary">Comment</button>
        </form>
      </div>
      <aside class="issue-side">
        <label class="fld"><span>Status</span>${sel('status', s.vocab.statuses.map((x) => [x.id, x.label]), i.status)}</label>
        <label class="fld"><span>Assignee</span>${sel('assignee', [['', 'Nobody'], ...activeStaff().map((e) => [e.id, e.name])], i.assignee)}</label>
        <label class="fld"><span>Priority</span>${sel('priority', s.vocab.priorities.map((p) => [p, p]), i.priority)}</label>
        <label class="fld"><span>Goal</span>${sel('goalId', [['', 'None'], ...s.goals.map((g) => [g.id, g.title])], i.goalId)}</label>
        ${waits.length ? `<div class="fld"><span>Waits on</span>${waits.map((w) => issueCard(w, { compact: true })).join('')}</div>` : ''}
        ${i.lane?.length ? `<div class="fld"><span>Only edits</span><code>${esc(i.lane.join(', '))}</code></div>` : ''}
        <p class="meta">Created ${esc(ago(i.createdAt))} by ${esc(i.createdBy === 'you' ? 'you' : employee(i.createdBy)?.name ?? i.createdBy)}${goal ? ` · for “${esc(goal.title)}”` : ''}</p>
        ${i.work?.startedAt ? `<p class="meta">Checked out ${esc(ago(i.work.startedAt))}${i.work.retries ? ` · reminded ${i.work.retries}×` : ''}</p>` : ''}
        <p class="danger-zone">${i.status !== 'cancelled' ? '<button class="btn tiny" data-act="cancel">Cancel issue</button>' : ''}
          <button class="btn tiny danger" data-act="delete">Delete</button></p>
      </aside>
    </div>`;
}

function extra(r) {
  return `${r.result ? `<h4>What ${esc(employee(r.issue.assignee)?.name ?? 'the agent')} wrote back <span class="when">${esc(ago(r.result.at))}</span></h4>
      <pre class="result">${esc(r.result.text)}</pre>` : ''}
    ${r.activity.length ? `<h4>History</h4><ul class="feed">${r.activity.map(feedLine).join('')}</ul>` : ''}`;
}

/* ── Events (app.js forwards them while this page is showing) ── */
export async function click(e, arg) {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (!a) return;
  if (a === 'new') return issueForm();
  const i = issueById(arg);
  if (!i) return;
  if (a === 'edit') return issueForm(i);
  if (a === 'sub') return issueForm(null, { parentId: i.id, goalId: i.goalId, assignee: i.assignee });
  if (a === 'accept') return act('issues', { id: i.id, status: 'done' });
  if (a === 'start') return act('issues', { id: i.id, status: 'in_progress' });
  if (a === 'reopen') return act('issues', { id: i.id, status: 'todo' });
  if (a === 'cancel') return act('issues', { id: i.id, status: 'cancelled' });
  if (a === 'changes') {
    const r = await dialog({ title: `What should change in ${keyOf(i)}?`,
      body: '<label class="fld"><span>Your note goes to the assignee with the issue</span><textarea name="text" rows="4" autofocus required></textarea></label>',
      actions: [{ act: 'send', label: 'Send back', primary: true }] });
    if (!r?.values.text.trim()) return;
    await act('issues/comment', { id: i.id, text: r.values.text });
    return act('issues', { id: i.id, status: 'todo' });
  }
  if (a === 'delete') {
    if (!await ask(`Delete ${keyOf(i)}?`, { yes: 'Delete', danger: true, detail: 'It is gone for good. Cancelling keeps it on record instead.' })) return;
    if (await act('issues/delete', { id: i.id })) go('issues');
  }
}

export async function change(e, arg) {
  const f = e.target.closest('[data-filter]');
  if (f) {
    filter[f.dataset.filter] = f.type === 'checkbox' ? f.checked : f.value;
    if (f.type !== 'search') dispatchEvent(new Event('owo:repaint'));
    return;
  }
  const field = e.target.closest('[data-field]');
  if (field && arg) {
    const r = await act('issues', { id: arg, [field.dataset.field]: field.value || null });
    if (r && field.dataset.field === 'status' && field.value === 'in_progress') headMsg('Handed to its assignee — they start at once while the company runs.', { bad: false, forMs: 4000 });
  }
}

export function keydown(e) {
  const f = e.target.closest('[data-filter="q"]');
  if (f && e.key === 'Enter') { e.preventDefault(); filter.q = f.value; dispatchEvent(new Event('owo:repaint')); }
  if (e.target.matches('[data-comment] textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
}

export async function submit(e, arg) {
  if (e.target.matches('[data-quick]')) {
    e.preventDefault();
    const title = e.target.title.value.trim();
    if (!title) return;
    const r = await act('issues', { title, assignee: e.target.assignee.value || null, goalId: filter.goal || null });
    if (r) { headMsg(`${keyOf(r.issue)} created.`, { bad: false, forMs: 2500 }); e.target.title.value = ''; e.target.title.blur(); dispatchEvent(new Event('owo:repaint')); document.querySelector('[data-quick] input')?.focus(); }
  }
  if (e.target.matches('[data-comment]')) {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    const r = await act('issues/comment', { id: arg, text });
    if (r) { e.target.text.value = ''; e.target.text.blur(); if (r.told) headMsg('Sent to their agent.', { bad: false, forMs: 3000 }); dispatchEvent(new Event('owo:repaint')); }
  }
}

/* ── Drag between columns ── */
export function dragstart(e) {
  const card = e.target.closest('[data-issue]');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.issue);
  e.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
}
export function dragover(e) {
  const col = e.target.closest('[data-col]');
  if (!col) return;
  e.preventDefault();
  document.querySelectorAll('.kcol.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
}
export function dragleave(e) {
  const col = e.target.closest('[data-col]');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
}
export function dragend() {
  document.querySelectorAll('.dragging, .kcol.drop').forEach((x) => x.classList.remove('dragging', 'drop'));
}
export async function drop(e) {
  const col = e.target.closest('[data-col]');
  const id = e.dataTransfer.getData('text/plain');
  dragend();
  if (!col || !id) return;
  e.preventDefault();
  const i = issueById(id);
  if (!i || i.status === col.dataset.col) return;
  const r = await act('issues', { id, status: col.dataset.col });
  if (r) headMsg(col.dataset.col === 'in_progress'
    ? `${keyOf(i)} handed to ${employee(i.assignee)?.name ?? 'its assignee'} — they start at once while the company runs.`
    : `${keyOf(i)} → ${statusLabel(col.dataset.col)}.`, { bad: false, forMs: 3000 });
}
