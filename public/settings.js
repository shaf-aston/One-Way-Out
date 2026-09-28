// Settings — the company (name, mission, how much you approve), moving it between machines,
// and Herdr's own look and behaviour. Every control saves the moment you change it.
// What may change in Herdr's file is decided on the server (src/herdrsettings.mjs).
import { esc, get, post, ask, headMsg, dialog } from './ui.js';
import { theState, act, cid, loadCompanies, choose, allCompanies } from './store.js';
import { go } from './router.js';

let herdr = null;       // Herdr's settings, read once per visit

function control(s, value) {
  const v = value ?? s.default;
  const name = `${s.section}.${s.id}`;
  if (s.type === 'bool') {
    return `<label class="set-switch"><input type="checkbox" data-key="${name}" ${v ? 'checked' : ''} />
      <span>${v ? 'On' : 'Off'}</span></label>`;
  }
  if (s.type === 'enum') {
    return `<select data-key="${name}">${s.choices.map((c) =>
      `<option value="${esc(c)}" ${c === v ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  }
  return `<input type="color" data-key="${name}" value="${esc(v)}" />`;
}

const row = (s, value) => `<div class="set-row">
    <div class="set-text"><strong>${esc(s.label)}</strong>
      <small>${esc(s.hint)}${value === undefined ? ' (Herdr default)' : ''}</small></div>
    <div class="set-control">${control(s, value)}</div>
  </div>`;

export function draw(el, s) {
  if (!herdr) get('/api/terminal/settings').then((r) => { herdr = r; dispatchEvent(new Event('owo:repaint')); });
  const c = s?.company;
  el.innerHTML = `<div class="page-head"><h2 class="display">Settings</h2></div>
    ${c ? `<section class="set-block"><h3>${esc(c.name)}</h3>
      <div class="set-list">
        <div class="set-row"><div class="set-text"><strong>Name</strong></div>
          <div class="set-control"><input data-co="name" maxlength="60" value="${esc(c.name)}"></div></div>
        <div class="set-row"><div class="set-text"><strong>Mission</strong><small>Every brief starts with it.</small></div>
          <div class="set-control wide"><textarea data-co="mission" rows="2" maxlength="600">${esc(c.mission)}</textarea></div></div>
        <div class="set-row"><div class="set-text"><strong>Approve plans</strong><small>Issues and hires an agent proposes wait in your Inbox.</small></div>
          <div class="set-control"><label class="set-switch"><input type="checkbox" data-co="approvePlans" ${c.approvePlans ? 'checked' : ''}><span>${c.approvePlans ? 'On' : 'Off'}</span></label></div></div>
        <div class="set-row"><div class="set-text"><strong>Review finished work</strong><small>Off: a result file moves an issue straight to Done. On: it waits in review for you.</small></div>
          <div class="set-control"><label class="set-switch"><input type="checkbox" data-co="review" ${c.review === 'you' ? 'checked' : ''}><span>${c.review === 'you' ? 'On' : 'Off'}</span></label></div></div>
        <div class="set-row"><div class="set-text"><strong>Folder</strong><small>Where every employee's agent works.</small></div>
          <div class="set-control"><code>${esc(c.folder)}</code></div></div>
        <div class="set-row"><div class="set-text"><strong>Heartbeat</strong><small>How often the company looks at everyone's work. Set in config.json.</small></div>
          <div class="set-control"><code>every ${Math.round((s.tickMs ?? 5000) / 1000)}s</code></div></div>
      </div>
      <div class="set-foot">
        <a class="btn" href="/api/c/${esc(cid())}/export" download>Export company</a>
        <a class="btn" href="#/dashboard/new">＋ New or import</a>
        <button class="btn danger" data-act="delete">Delete company…</button>
      </div>
    </section>` : '<section class="set-block"><p>No company yet. <a href="#/dashboard/new">Start one</a>.</p></section>'}
    <section class="set-block"><h3>Herdr</h3>
      <p class="muted-note">How Herdr itself looks and behaves. Changes save at once and Herdr picks them up without restarting;
        your old settings file is kept as a dated copy beside it.</p>
      <div class="set-list">${!herdr ? '<p class="muted-note">Reading…</p>' : herdr.ok ? herdr.settings.map((x) => row(x, herdr.values[`${x.section}.${x.id}`])).join('')
        : `<p class="muted-note">Could not read Herdr's settings: ${esc(herdr.error)}</p>`}</div>
    </section>`;
}

export async function change(e) {
  const co = e.target.closest('[data-co]');
  if (co) {
    const k = co.dataset.co;
    const value = k === 'review' ? (co.checked ? 'you' : 'auto') : co.type === 'checkbox' ? co.checked : co.value;
    if (await act('company', { [k]: value })) headMsg('Saved.', { bad: false, forMs: 2000 });
    return;
  }
  const el = e.target.closest('[data-key]');
  if (!el) return;
  const value = el.type === 'checkbox' ? el.checked : el.value;
  headMsg('Saving…', { bad: false });
  const res = await post('/api/terminal/settings', { changes: { [el.dataset.key]: value } });
  if (!res.ok) { headMsg(res.error); return; }
  herdr = { ...herdr, values: res.values };
  if (el.type === 'checkbox') el.nextElementSibling.textContent = value ? 'On' : 'Off';
  headMsg(res.diagnostics?.length ? `Saved, but Herdr says: ${res.diagnostics.join('; ')}` : 'Saved — Herdr updated', { bad: !!res.diagnostics?.length, forMs: 3000 });
}

export async function click(e) {
  if (!e.target.closest('[data-act="delete"]')) return;
  const c = theState()?.company;
  if (!c) return;
  if (!await ask(`Delete ${c.name}?`, { yes: 'Continue', danger: true,
    detail: 'Its goals, issues, people and history are removed from this machine. Running agents are not closed. Export it first if you might want it back.' })) return;
  const r = await dialog({ title: 'Type the company id to confirm', body: `<label class="fld"><span>${esc(c.id)}</span><input name="confirm" autofocus></label>`,
    actions: [{ act: 'delete', label: 'Delete for good', primary: true, danger: true }] });
  if (!r) return;
  const out = await post(`/api/c/${c.id}/delete`, { confirm: r.values.confirm.trim() });
  if (!out.ok) return headMsg(out.error);
  await loadCompanies();
  await choose(allCompanies()[0]?.id ?? null);
  go('dashboard');
}

