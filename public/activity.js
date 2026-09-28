// Activity — everything that happened in the company, newest first, and who did it.
import { esc, get } from './ui.js';
import { cid } from './store.js';
import { feedLine } from './dashboard.js';

const f = { actor: '', type: '', q: '' };
let cache = { key: '', lines: null };

export function draw(el, s) {
  const key = `${cid()}|${f.actor}|${f.type}|${f.q}|${s.activity[0]?.at ?? 0}`;
  if (cache.key !== key) {
    cache = { key, lines: cache.lines };
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    get(`/api/c/${cid()}/activity?${q}`).then((r) => {
      if (!r.ok || cache.key !== key) return;
      cache.lines = r.activity;
      const list = document.querySelector('[data-log]');
      if (list) list.innerHTML = lines(r.activity);
    });
  }
  const who = [['', 'Anyone'], ['you', 'You'], ['system', 'Heartbeat'], ...s.employees.map((e) => [e.id, e.name])];
  const what = [['', 'Everything'], ['issue', 'Issues'], ['employee', 'People'], ['goal', 'Goals'], ['routine', 'Routines'], ['company', 'Company']];
  const sel = (name, rows) => `<select data-f="${name}" aria-label="${name}">${rows.map(([v, t]) => `<option value="${esc(v)}" ${v === f[name] ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="page-head"><h2 class="display">Activity</h2></div>
    <div class="filters">${sel('actor', who)}${sel('type', what)}
      <input type="search" data-f="q" value="${esc(f.q)}" placeholder="Search" aria-label="Search activity"></div>
    <ul class="feed big" data-log>${cache.lines ? lines(cache.lines) : '<li class="muted-note">Reading…</li>'}</ul>`;
}

const lines = (list) => list.map(feedLine).join('') || '<li class="muted-note">Nothing matches.</li>';

export function change(e) {
  const x = e.target.closest('[data-f]');
  if (!x) return;
  f[x.dataset.f] = x.value;
  dispatchEvent(new Event('owo:repaint'));
}
