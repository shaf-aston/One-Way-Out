// Dashboard — home. What needs you first, then how the company is doing, then who is on it.
// With no company yet, it is the three-field setup instead: a name, a mission, a folder.
import { esc, get, post, headMsg, ago } from './ui.js';
import { theState, allCompanies, allTemplates, choose, loadCompanies, act, employee, keyOf, liveOf, pending, cid } from './store.js';
import { employeeCard, onEmployeeAction, issueCard, issueForm, employeeForm, planGoal } from './parts.js';
import { go } from './router.js';

export function draw(el, s, arg) {
  if (!allCompanies().length || arg === 'new' || !cid()) {
    // The setup form is drawn once: a poll must never wipe what is being typed into it.
    if (!el.querySelector('.setup-form')) drawSetup(el);
    return;
  }
  if (!s) return;
  const byStatus = (st) => s.issues.filter((i) => i.status === st);
  const review = byStatus('in_review');
  const blocked = byStatus('blocked');
  const asking = s.employees.filter((e) => liveOf(e.id)?.status === 'blocked');
  const over = s.employees.filter((e) => e.state === 'over-budget');
  const approvals = pending();
  const today = new Date().toDateString();
  const doneToday = s.issues.filter((i) => i.status === 'done' && new Date(i.work?.finishedAt ?? i.updatedAt).toDateString() === today).length;
  const needs = approvals.length + review.length + blocked.length + asking.length + over.length;
  const staff = s.employees.filter((e) => e.state !== 'terminated');

  el.innerHTML = `<div class="page-head">
      <div><h2 class="display">${esc(s.company.name)}</h2>
        ${s.company.mission ? `<p class="mission">${esc(s.company.mission)}</p>` : '<p class="mission muted"><a href="#/settings">Add a mission</a> — every brief starts with it.</p>'}</div>
      <div class="actions">
        <button class="btn primary" data-act="issue" title="C">＋ Issue</button>
        <button class="btn" data-act="plan" title="The CEO splits it into issues for the team">Plan a goal</button>
        <button class="btn" data-act="hire">Hire</button>
      </div>
    </div>
    ${s.company.running ? '' : `<div class="banner">
      <p><b>Paused.</b> Nobody is given work until you run the company. ${s.issues.some((i) => i.status === 'todo' && i.assignee) ? 'Issues are assigned and waiting.' : 'Create an issue or plan a goal first.'}</p>
      <button class="btn primary" data-act="run">▶ Run company</button></div>`}
    ${s.herdr !== 'ok' ? `<div class="banner bad"><p><b>Herdr is not answering.</b> ${esc(s.herdr)}</p></div>` : ''}

    <section class="needs-you ${needs ? '' : 'calm'}">
      <h3>Needs you ${needs ? `<span class="badge">${needs}</span>` : ''}</h3>
      ${needs ? `<ul class="need-list">
        ${approvals.map((a) => `<li><a href="#/inbox"><b>${a.kind === 'budget' ? 'Budget' : 'Plan'}</b> ${esc(approvalLine(a))}</a></li>`).join('')}
        ${review.map((i) => `<li class="row"><a href="#/issues/${esc(i.id)}"><b>Review</b> ${esc(keyOf(i))} ${esc(i.title)}</a>
          <span class="row-acts"><button class="btn tiny primary" data-accept="${esc(i.id)}">Accept</button></span></li>`).join('')}
        ${blocked.map((i) => `<li><a href="#/issues/${esc(i.id)}"><b>Blocked</b> ${esc(keyOf(i))} ${esc(i.title)}</a></li>`).join('')}
        ${asking.map((e) => `<li class="row" data-pane="${esc(liveOf(e.id).paneId)}" data-label="${esc(e.name)}" data-cwd="${esc(s.company.folder)}">
          <button class="open linkish"><b>Question</b> ${esc(e.name)} is waiting for an answer — open their agent</button></li>`).join('')}
        ${over.map((e) => `<li><a href="#/inbox"><b>Budget</b> ${esc(e.name)} is paused: ${esc(e.over ?? 'over a cap')}</a></li>`).join('')}
      </ul>` : '<p class="muted-note">Nothing. Everyone either has work or is waiting for some.</p>'}
    </section>

    <section class="stats">
      ${stat('To do', byStatus('todo').length, '#/issues')}
      ${stat('In progress', byStatus('in_progress').length, '#/issues')}
      ${stat('In review', review.length, '#/issues')}
      ${stat('Done today', doneToday, '#/issues')}
      ${stat('Backlog', byStatus('backlog').length, '#/issues')}
    </section>

    <div class="dash-cols">
      <section>
        <div class="sec-head"><h3>Team</h3><a class="btn tiny" href="#/org">Org chart</a></div>
        ${staff.length ? `<div class="emps">${staff.map((e) => employeeCard(e)).join('')}</div>`
          : '<p class="muted-note">Nobody works here yet. <button class="btn tiny" data-act="hire">Hire someone</button></p>'}
      </section>
      <section>
        <div class="sec-head"><h3>Working now</h3></div>
        ${byStatus('in_progress').map((i) => issueCard(i)).join('') || '<p class="muted-note">Nothing in progress.</p>'}
        <div class="sec-head"><h3>Recent</h3><a class="btn tiny" href="#/activity">All activity</a></div>
        <ul class="feed">${s.activity.slice(0, 12).map(feedLine).join('') || '<li class="muted-note">Nothing has happened yet.</li>'}</ul>
      </section>
    </div>`;
}

const stat = (label, n, href) => `<a class="stat" href="${href}"><b>${n}</b><span>${esc(label)}</span></a>`;

export const approvalLine = (a) => (a.kind === 'budget'
  ? `${employee(a.payload.employeeId)?.name ?? a.payload.employeeId} hit ${a.payload.used}/${a.payload.limit} (${a.payload.cap})`
  : `${employee(a.by)?.name ?? a.by} proposes ${a.payload.issues?.length ?? 0} issue(s)${a.payload.hires?.length ? ` and ${a.payload.hires.length} hire(s)` : ''}`);

export const feedLine = (l) => {
  const who = l.actor === 'you' ? 'You' : l.actor === 'system' ? 'Heartbeat' : employee(l.actor)?.name ?? l.actor;
  const link = l.object?.type === 'issue' ? `#/issues/${l.object.id}` : l.object?.type === 'employee' ? '#/org' : l.object?.type === 'routine' ? '#/routines' : null;
  return `<li><span class="when" title="${esc(new Date(l.at).toLocaleString())}">${esc(ago(l.at))}</span>
    <span class="actor">${esc(who)}</span> ${link ? `<a href="${link}">${esc(l.detail)}</a>` : esc(l.detail)}</li>`;
};

/** Clicks on this page (app.js forwards them while it is the one showing). */
export async function click(e) {
  if (!theState() || e.target.closest('.setup')) return;
  if (await onEmployeeAction(e)) return;
  const accept = e.target.closest('[data-accept]')?.dataset.accept;
  if (accept) { e.preventDefault(); await act('issues', { id: accept, status: 'done' }); return; }
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'issue') issueForm();
  if (a === 'plan') planGoal();
  if (a === 'hire') employeeForm();
  if (a === 'run') await act('company', { running: true });
}

/* ── First run: set up a company ── */
async function drawSetup(el) {
  const tpls = allTemplates();
  el.innerHTML = `<div class="setup">
    <h2 class="display">${allCompanies().length ? 'Start another company' : 'Start a company'}</h2>
    <p class="lede">A company is a team of AI agents with one mission. You set goals and approve plans; they pick up issues, do the work, and report back. Nothing runs until you press <b>Run</b>.</p>
    <form class="setup-form" novalidate>
      <label class="fld"><span>Name</span><input name="name" maxlength="60" required autofocus placeholder="e.g. Acme"></label>
      <label class="fld"><span>Mission — one sentence every agent reads first</span>
        <textarea name="mission" rows="2" maxlength="600" placeholder="e.g. Build the simplest invoicing app a freelancer could want"></textarea></label>
      <label class="fld"><span>Folder its agents work in</span><input name="folder" required placeholder="C:\\Users\\you\\my-project"></label>
      <div class="folder-list" data-folders>Reading your folders…</div>
      <fieldset class="tpl"><legend>Starting team</legend>
        ${tpls.map((t, n) => `<label class="tpl-card"><input type="radio" name="template" value="${esc(t.id)}" ${n === 1 ? 'checked' : ''}>
          <b>${esc(t.name)}</b><small>${esc(t.why)}</small>
          <span class="tpl-team">${t.team.map((m) => `${esc(m.name)} <i>${esc(m.title)}</i>`).join(' · ')}</span></label>`).join('')}
      </fieldset>
      <details class="more"><summary>How much you want to approve</summary>
        <label class="check"><input type="checkbox" name="approvePlans" checked> Plans (issues and hires an agent proposes) wait for my approval</label>
        <label class="check"><input type="checkbox" name="review"> Finished work waits for my review before it counts as done</label>
      </details>
      <p class="bad-note" data-err hidden></p>
      <div class="setup-foot">
        <button class="btn primary" type="submit">Create company</button>
        ${allCompanies().length ? '<a class="btn" href="#/">Cancel</a>' : ''}
        <label class="btn linkish import">Import a company file<input type="file" accept=".json,application/json" hidden data-import></label>
      </div>
    </form>
  </div>`;
  const form = el.querySelector('form');
  // Fields by name through `elements`: `form.name` is the form's own name attribute, not the field.
  const f = (n) => form.elements.namedItem(n);
  const err = el.querySelector('[data-err]');
  get('/api/projects').then((r) => {
    const box = el.querySelector('[data-folders]');
    if (!box) return;
    box.innerHTML = r.ok && r.projects.length ? r.projects.slice(0, 18).map((p) => `<button type="button" class="chip" data-folder="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`).join('') : '';
  });
  el.querySelector('[data-folders]').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-folder]');
    if (!chip) return;
    f('folder').value = chip.dataset.folder;
    if (!f('name').value) f('name').value = chip.textContent;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await post('/api/companies', {
      name: f('name').value, mission: f('mission').value, folder: f('folder').value.trim(),
      template: f('template')?.value, approvePlans: f('approvePlans').checked, review: f('review').checked ? 'you' : 'auto',
    });
    if (!r.ok) { err.hidden = false; err.textContent = r.error; return; }
    await loadCompanies();
    await choose(r.company.id);
    headMsg(`${r.company.name} is set up. Create an issue or plan a goal, then press Run company.`, { bad: false, forMs: 8000 });
    if (window.location.hash === '#/' || window.location.hash === '') dispatchEvent(new Event('owo:repaint')); else go('dashboard');
  });
  el.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let bundle;
    try { bundle = JSON.parse(await file.text()); } catch { err.hidden = false; err.textContent = 'That file is not JSON.'; return; }
    const r = await post('/api/companies/import', { bundle });
    if (!r.ok) { err.hidden = false; err.textContent = r.error; return; }
    await loadCompanies();
    await choose(r.company.id);
    headMsg(`${r.company.name} imported.`, { bad: false, forMs: 5000 });
    go('dashboard');
  });
}
