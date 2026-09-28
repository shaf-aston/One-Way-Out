// Org — who works here and who they report to, drawn as tiers from the reporting lines. Hire
// someone new, or hire an agent that is already running in Herdr so it keeps its conversation.
import { esc } from './ui.js';
import { theState, employee } from './store.js';
import { tiersOf } from './tiers.js';
import { employeeCard, onEmployeeAction, employeeForm } from './parts.js';

export function draw(el, s) {
  const staff = s.employees.filter((e) => e.state !== 'terminated');
  const gone = s.employees.filter((e) => e.state === 'terminated');
  // Reporting lines are the only thing the chart is drawn from — "reports to" is a manages line.
  const lines = staff.filter((e) => e.reportsTo).map((e) => ({ from: e.reportsTo, to: e.id, kind: 'manages' }));
  const { tiers, loose } = tiersOf(lines, staff.map((e) => e.id));
  const rows = tiers.length ? tiers : [];
  const solo = tiers.length ? loose : staff.map((e) => e.id);
  const rank = (n) => (n === 0 ? 'Leads' : n === 1 ? 'Reports' : `Tier ${n + 1}`);
  el.innerHTML = `<div class="page-head"><h2 class="display">Org chart</h2>
      <div class="actions"><button class="btn primary" data-act="hire">＋ Hire</button></div></div>
    ${rows.map((ids, n) => `<div class="org-row"><div class="org-rank">${rank(n)}</div>
      <div class="org-cards">${ids.map((id) => employeeCard(employee(id))).join('')}</div></div>`).join('')}
    ${solo.length ? `<div class="org-row"><div class="org-rank">${tiers.length ? 'Nobody above' : 'Team'}</div>
      <div class="org-cards">${solo.map((id) => employeeCard(employee(id))).join('')}</div></div>` : ''}
    ${!staff.length ? '<div class="state"><p>Nobody works here yet.</p></div>' : ''}
    ${s.unhired.length ? `<section class="unhired"><h3>Running in Herdr, not on the team</h3>
      <p class="muted-note">Hire one and it joins with its conversation intact.</p>
      <div class="chips">${s.unhired.map((a) => `<button class="chip" data-bind="${esc(a.id)}" data-name="${esc(a.label)}" title="${esc(a.cwd ?? '')}">＋ ${esc(a.label)}</button>`).join('')}</div></section>` : ''}
    ${gone.length ? `<details class="gone"><summary>Former employees (${gone.length})</summary><p class="muted-note">${gone.map((e) => `${esc(e.name)} — ${esc(e.title)}`).join(' · ')}</p></details>` : ''}`;
}

export async function click(e) {
  if (!theState()) return;
  if (await onEmployeeAction(e)) return;
  if (e.target.closest('[data-act="hire"]')) return employeeForm();
  const b = e.target.closest('[data-bind]');
  if (b) return employeeForm(null, { bindPane: b.dataset.bind, name: b.dataset.name.slice(0, 40) });
}
