// Routines — work that repeats. Each time one comes round it creates an issue for its assignee,
// who picks it up at their next heartbeat like any other.
import { esc, ago } from './ui.js';
import { theState, act, employee } from './store.js';
import { routineForm } from './parts.js';

export function draw(el, s) {
  el.innerHTML = `<div class="page-head"><h2 class="display">Routines</h2>
      <div class="actions"><button class="btn primary" data-act="new">＋ Routine</button></div></div>
    ${s.routines.length ? `<table class="table"><thead><tr><th>Routine</th><th>When</th><th>Who</th><th>Last ran</th><th>On</th></tr></thead><tbody>
      ${s.routines.map((r) => `<tr>
        <td><button class="linkish" data-act="edit" data-id="${esc(r.id)}">${esc(r.title)}</button></td>
        <td>${esc(r.when)}</td>
        <td>${esc(employee(r.assignee)?.name ?? 'Backlog')}</td>
        <td>${r.lastFiredAt ? esc(ago(r.lastFiredAt)) : '—'}</td>
        <td><label class="set-switch"><input type="checkbox" data-toggle="${esc(r.id)}" ${r.enabled ? 'checked' : ''}><span>${r.enabled ? 'On' : 'Off'}</span></label></td>
      </tr>`).join('')}</tbody></table>
      ${s.company.running ? '' : '<p class="muted-note">The company is paused, so no routine fires until you run it.</p>'}`
      : '<div class="state"><p>No routines yet. A routine is an issue that makes itself: “every weekday at 09:00, check the dependencies”.</p></div>'}`;
}

export async function click(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'new') return routineForm();
  if (b.dataset.act === 'edit') return routineForm(theState().routines.find((r) => r.id === b.dataset.id));
}

export async function change(e) {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  const r = theState().routines.find((x) => x.id === t.dataset.toggle);
  if (r) await act('routines', { ...r, enabled: t.checked });
}
