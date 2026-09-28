// The glue: which page is on screen, which company it is about, and the header around it.
// No business rules — every page draws from the one company read in store.js, and every
// change goes back through the server, which checks it.
import { $, esc, headMsg, onOverlayEscape } from './ui.js';
import { startRouter, go, HOME } from './router.js';
import { bindKey, startKeys } from './keys.js';
import { startGuide } from './guide.js';
import { closeSheet, setPollMs, watchCards } from './agent-view.js';
import { startMap, stopMap, refreshMap, openSpawn } from './map.js';
import { loadCompanies, allCompanies, cid, choose, refresh, onState, theState, act, pending } from './store.js';
import * as dashboard from './dashboard.js';
import * as issues from './issues.js';
import * as goals from './goals.js';
import * as org from './org.js';
import * as routines from './routines.js';
import * as inbox from './inbox.js';
import * as activity from './activity.js';
import * as settings from './settings.js';

let cfg = { pollIntervalMs: 1500, promptScanMs: 5000 };
try { cfg = { ...cfg, ...(await (await fetch('/api/config')).json()) }; } catch {}
setPollMs(cfg.pollIntervalMs);
watchCards();
onOverlayEscape('.agent-overlay', () => closeSheet());

/* ── Pages ──
   A company page is a module with draw(el, state, arg): it paints from the company state and
   is painted again whenever that changes. Agents is the live Herdr map, which polls on its own
   and only while it is showing. Settings works with or without a company. */
const PAGES = { dashboard, issues, goals, org, routines, inbox, activity, settings };
const NEEDS_COMPANY = new Set(['issues', 'goals', 'org', 'routines', 'inbox', 'activity']);
let at = { view: HOME, arg: null };
const view = $('view');

/** Is the person in the middle of something on the page that a repaint would throw away? */
const busyHere = () => {
  const a = document.activeElement;
  return (a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!view.querySelector('.dragging');
};

function paint(force = false) {
  if (at.view === 'agents') return;
  if (!force && busyHere()) return;
  const page = PAGES[at.view];
  const s = theState();
  if (NEEDS_COMPANY.has(at.view) && !cid()) { go(HOME); return; }
  if (NEEDS_COMPANY.has(at.view) && !s) { view.innerHTML = '<div class="state"><div class="spin"></div><p>Reading the company…</p></div>'; return; }
  page.draw(view, s, at.arg);
}

// One listener for every page: whichever page is showing gets the event. Pages never add
// their own to #view, so nothing piles up as you move between them.
for (const type of ['click', 'change', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend', 'keydown', 'submit']) {
  view.addEventListener(type, (e) => { if (at.view !== 'agents') PAGES[at.view]?.[type]?.(e, at.arg); });
}

function show({ view: name, arg }) {
  const was = at.view;
  at = { view: name, arg };
  document.querySelectorAll('.side [data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
  if (was === 'agents' && name !== 'agents') stopMap();
  if (name === 'agents') { if (was !== 'agents') startMap(view, cfg); return; }
  if (was !== name) view.innerHTML = '';
  paint(true);
  if (was !== name) view.focus({ preventScroll: true });
}

/* ── The header: which company, and whether it is running ── */
function drawHeader(s) {
  const pick = $('co-pick');
  const list = allCompanies();
  pick.innerHTML = list.map((c) => `<option value="${esc(c.id)}" ${c.id === cid() ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
    + '<option value="__new">＋ New company…</option>';
  if (!list.length) pick.value = '__new';
  const run = $('run-toggle');
  run.hidden = !s;
  if (s) {
    const on = s.company.running;
    run.classList.toggle('on', on);
    run.innerHTML = on ? '<i class="pulse"></i> Running' : '▶ Run company';
    run.title = on ? 'The company is running: employees pick up work on their heartbeat. Click to pause it.'
      : 'Paused: nobody is given work. Click to let employees pick up their issues.';
  }
  const n = s ? pending().length : 0;
  $('inbox-count').hidden = !n;
  $('inbox-count').textContent = n;
  setLive(!s || s.herdr === 'ok', s && s.herdr !== 'ok' ? 'Herdr offline' : 'live');
}

function setLive(ok, text) {
  $('live').classList.toggle('stale', !ok);
  $('live-text').textContent = text;
  if (!ok) $('live').title = theState()?.herdr ?? '';
}

$('co-pick').addEventListener('change', async (e) => {
  if (e.target.value === '__new') { go(HOME, 'new'); return; }
  await choose(e.target.value);
});

$('run-toggle').addEventListener('click', async () => {
  const s = theState();
  if (!s) return;
  const on = !s.company.running;
  const r = await act('company', { running: on });
  if (r) headMsg(on ? 'Running. Employees with ready issues start now.' : 'Paused. Nobody is given new work; agents mid-issue carry on.', { bad: false, forMs: 5000 });
});

/* ── Keys: each page letter is the same link the nav uses ── */
const away = (run) => () => { if (!document.querySelector('.agent-overlay') || closeSheet()) run(); };
bindKey('go-dashboard', away(() => go('dashboard')));
bindKey('go-issues', away(() => go('issues')));
bindKey('go-goals', away(() => go('goals')));
bindKey('go-org', away(() => go('org')));
bindKey('go-routines', away(() => go('routines')));
bindKey('go-inbox', away(() => go('inbox')));
bindKey('go-activity', away(() => go('activity')));
bindKey('go-agents', away(() => go('agents')));
bindKey('new-issue', away(() => { if (cid()) issues.newIssue(); }));
bindKey('new-agent', away(() => openSpawn()));
startGuide(bindKey);
startKeys();

/* ── Start ── */
await loadCompanies();
onState((s) => { drawHeader(s); paint(); });
startRouter(['agents', ...Object.keys(PAGES)], show);
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, cfg.pollIntervalMs);
window.addEventListener('focus', () => { refresh(); refreshMap(); });
// A page asked to be drawn again whatever it was showing (after it opened a dialog, say).
addEventListener('owo:repaint', () => paint(true));
