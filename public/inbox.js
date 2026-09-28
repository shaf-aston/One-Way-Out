// Inbox — what is waiting for the board's yes or no: plans (issues and hires an agent proposed)
// and budget caps an employee hit. Approving a plan creates its issues and hires at once.
import { esc, ago, dialog, headMsg } from './ui.js';
import { theState, act, employee, keyOf, issueById, pending } from './store.js';

export function draw(el, s) {
  const open = pending();
  const done = s.approvals.filter((a) => a.state !== 'pending').slice(-15).reverse();
  el.innerHTML = `<div class="page-head"><h2 class="display">Inbox</h2></div>
    ${open.length ? open.map(card).join('') : '<div class="state"><p>Nothing is waiting for you.</p></div>'}
    ${done.length ? `<details class="gone"><summary>Decided (${done.length})</summary><ul class="feed">${done.map((a) =>
      `<li><span class="when">${esc(ago(a.decidedAt))}</span> <b>${esc(a.state)}</b> ${esc(summary(a))}${a.note ? ` — “${esc(a.note)}”` : ''}</li>`).join('')}</ul></details>` : ''}`;
}

function summary(a) {
  if (a.kind === 'budget') return `${employee(a.payload.employeeId)?.name ?? a.payload.employeeId}'s ${a.payload.cap} budget`;
  const parent = issueById(a.payload.issueId);
  return `plan for ${parent ? `${keyOf(parent)} ${parent.title}` : a.payload.issueId}`;
}

function card(a) {
  if (a.kind === 'budget') {
    const e = employee(a.payload.employeeId);
    return `<article class="approval" data-id="${esc(a.id)}">
      <h3>Budget · ${esc(e?.name ?? a.payload.employeeId)}</h3>
      <p>Used <b>${a.payload.used}</b> of ${a.payload.limit} (${esc(a.payload.cap)}) and was paused ${esc(ago(a.at))}.</p>
      <div class="ap-acts">
        <label class="fld inline"><span>Raise the cap to</span><input type="number" min="${a.payload.used + 1}" value="${a.payload.raiseTo}" data-raise></label>
        <button class="btn primary" data-decide="approve">Raise and resume</button>
        <button class="btn" data-decide="reject">Keep paused</button>
      </div></article>`;
  }
  const parent = issueById(a.payload.issueId);
  const staff = theState().employees;
  const name = (id) => staff.find((x) => x.id === id)?.name;
  return `<article class="approval" data-id="${esc(a.id)}">
    <h3>Plan · ${esc(employee(a.by)?.name ?? a.by)}${parent ? ` for <a href="#/issues/${esc(parent.id)}">${esc(keyOf(parent))} ${esc(parent.title)}</a>` : ''}</h3>
    <p class="when">${esc(ago(a.at))}</p>
    ${a.payload.hires?.length ? `<h4>Wants to hire</h4><ul class="plan-list">${a.payload.hires.map((h) =>
      `<li><b>${esc(h.name)}</b> — ${esc(h.title || 'Engineer')}, reports to ${esc(name(h.reportsTo) ?? employee(a.by)?.name ?? 'the planner')}<small>${esc(h.job)}</small></li>`).join('')}</ul>` : ''}
    <h4>${a.payload.issues.length} issue${a.payload.issues.length === 1 ? '' : 's'}</h4>
    <ol class="plan-list">${a.payload.issues.map((d) => `<li><b>${esc(d.title)}</b>
      <span class="who">${esc(name(d.assignee) ?? (a.payload.hires?.length ? 'to be assigned' : 'unassigned'))}</span>
      ${d.priority !== 'medium' ? `<span class="prio">${esc(d.priority)}</span>` : ''}
      ${d.after?.length ? `<span class="waits">after ${esc(d.after.map((r) => a.payload.issues.find((x) => x.ref === r)?.title ?? r).join(', '))}</span>` : ''}
      ${d.body ? `<small>${esc(d.body.slice(0, 400))}</small>` : ''}</li>`).join('')}</ol>
    <div class="ap-acts">
      <button class="btn primary" data-decide="approve">Approve plan</button>
      <button class="btn" data-decide="reject">Reject…</button>
    </div></article>`;
}

export async function click(e) {
  const b = e.target.closest('[data-decide]');
  if (!b) return;
  const box = b.closest('[data-id]');
  const decision = b.dataset.decide;
  let note = '';
  if (decision === 'reject' && !box.querySelector('[data-raise]')) {
    const r = await dialog({ title: 'Reject this plan?', body: '<label class="fld"><span>Why — the planner is told</span><textarea name="note" rows="3" autofocus></textarea></label>',
      actions: [{ act: 'reject', label: 'Reject', primary: true, danger: true }] });
    if (!r) return;
    note = r.values.note;
  }
  const raiseTo = Number(box.querySelector('[data-raise]')?.value) || undefined;
  const out = await act('approvals/decide', { id: box.dataset.id, decision, note, raiseTo });
  if (out) headMsg(decision === 'approve' ? 'Approved.' : 'Rejected.', { bad: false, forMs: 3000 });
}
