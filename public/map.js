// Agents: the live map of every agent running in Herdr — company employees and anything else.
// Read, answer and move them from here. It polls only while it is the page on screen, so the
// company pages are not paying for a map nobody is looking at.
import { $, esc, basename, get, post, ask, onOverlayEscape, headMsg, setModel, theModel } from './ui.js';
import { moveButton } from './move.js';
import { theState } from './store.js';

let host = null;
let timers = [];

/** The employee of the company on screen who is running in this pane, if any. */
function staffOf(p) {
  const s = theState();
  if (!s || !p.isAgent) return null;
  const id = Object.entries(s.live ?? {}).find(([, l]) => l?.paneId === p.id)?.[0];
  return id ? s.employees.find((e) => e.id === id) ?? null : null;
}

const STATUS = {
  working: { label:'Working', cls:'s-working', v:'--working' },
  blocked: { label:'Blocked', cls:'s-blocked', v:'--blocked' },
  done:    { label:'Done',    cls:'s-done',    v:'--done' },
  idle:    { label:'Idle',    cls:'s-idle',    v:'--idle' },
  unknown: { label:'Shell',   cls:'s-unknown', v:'--unknown' },
};

let pollMs = 1500;
let promptScanMs = 5000;

function setLive(ok, text) {
  $('live').classList.toggle('stale', !ok);
  if ($('live-text').textContent !== text) $('live-text').textContent = text;
}

/* ── Updating the board without redrawing it ──
   Setting innerHTML on the whole board throws away every card and builds new ones. The
   browser then replays each card's 0.4s fade-and-slide, so ONE agent changing its status
   made all twelve visibly re-appear at once. Measured 2026-09-03 with a simulated busy
   agent: 10 columns and every card destroyed in 12 seconds, with nothing else changing.
   Instead: match what is on screen to what should be, by a key, and touch only what
   genuinely differs. A card is keyed by its pane, a column by its state — so an agent
   moving between columns is carried across rather than rebuilt. */

/** Put `parent`'s children in step with `next`'s, matching on `keyAttr`.
 *  `update(old, new)` decides what happens to a child that exists in both; without it the
 *  old one is replaced only when its markup actually differs. */
function morphKeyed(parent, next, keyAttr, update) {
  const olds = new Map();
  for (const el of [...parent.children]) {
    const k = el.getAttribute(keyAttr);
    if (k === null) el.remove(); else olds.set(k, el);
  }
  let at = null;                       // the child the next one must follow, so order holds
  for (const n of [...next.children]) {
    const k = n.getAttribute(keyAttr);
    const o = k === null ? null : olds.get(k);
    let keep = n;
    if (o) {
      olds.delete(k);
      keep = o;
      if (update) update(o, n);
      else if (o.outerHTML !== n.outerHTML) { o.replaceWith(n); keep = n; }
    }
    if (keep.parentNode !== parent || keep.previousElementSibling !== at) {
      if (at) at.after(keep); else parent.prepend(keep);
    }
    at = keep;
  }
  for (const gone of olds.values()) gone.remove();
}

/** Copy attributes from `n` onto `o` without touching anything else about `o`. */
function syncAttrs(o, n) {
  for (const a of n.attributes) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
}

/** One column updated in place: its heading and count, then its cards one by one. */
function morphCol(o, n) {
  syncAttrs(o, n);
  const oh = o.querySelector('.col-head'), nh = n.querySelector('.col-head');
  if (oh && nh && oh.outerHTML !== nh.outerHTML) oh.replaceWith(nh);
  const ow = o.querySelector('.col-why'), nw = n.querySelector('.col-why');
  if (ow && nw && ow.innerHTML !== nw.innerHTML) ow.innerHTML = nw.innerHTML;
  const op = o.querySelector('.panes'), np = n.querySelector('.panes');
  if (op && np) morphKeyed(op, np, 'data-pane');
  else if (op !== np && (op?.outerHTML ?? '') !== (np?.outerHTML ?? '')) {
    // A column that just emptied, or just filled: swap that part only.
    const oNone = o.querySelector('.col-none'), nNone = n.querySelector('.col-none');
    if (np && oNone) oNone.replaceWith(np);
    else if (nNone && op) op.replaceWith(nNone);
  }
}

function morphBoard(host, html) {
  const next = document.createElement('div');
  next.innerHTML = html;
  const oldBoard = host.querySelector('.board'), newBoard = next.querySelector('.board');
  if (!oldBoard || !newBoard) { host.innerHTML = html; return; }
  syncAttrs(oldBoard, newBoard);
  morphKeyed(oldBoard, newBoard, 'data-col', morphCol);
  // The Terminals section sits outside the board and changes rarely.
  const oldTail = host.querySelector('.shells'), newTail = next.querySelector('.shells');
  if (newTail && !oldTail) oldBoard.after(newTail);
  else if (!newTail && oldTail) oldTail.remove();
  else if (newTail && oldTail && newTail.outerHTML !== oldTail.outerHTML) morphCol(oldTail, newTail);
}

function renderState(html) {
  $('state').innerHTML = html;
  for (const el of ['counts','waiting','legend','close-all']) $(el).hidden = true;
  $('workspaces').innerHTML = '';
}

// Which other agents sit in the same folder as this one. Filled in by render() from the
// server's shared-folder list, so the warning rides on the card it is about.
let sharedBy = new Map();


function card(p) {
  const st = STATUS[p.status] || STATUS.unknown;
  const mates = sharedBy.get(p.id) ?? [];
  const cls = ['card', p.isAgent ? `st-${p.status} agent-click` : 'terminal', p.focused ? 'focused' : ''].join(' ');
  // An agent card is an article with sibling buttons: the name opens it (and a stretched hit
  // area makes the whole card do the same), and the mover moves it. Nothing interactive sits
  // inside anything else interactive.
  return `<${p.isAgent ? 'article' : 'div'} class="${cls}" title="${esc(p.cwd ?? '')}" ${p.isAgent ? `data-pane="${esc(p.id)}" data-label="${esc(p.label)}" data-cwd="${esc(p.cwd ?? '')}" aria-label="${esc(p.label)}"` : ''}>
    <div class="top">
      ${p.isAgent
        ? `<button class="name open" aria-label="Open ${esc(p.label)}">${p.focused ? '<b title="Focused in Herdr">★</b> ' : ''}${esc(p.label)}</button>`
        : `<span class="name">${esc(p.label)}</span>`}
    </div>
    ${p.title ? `<div class="self-title">${esc(p.title)}</div>` : ''}
    <div class="status ${st.cls}"><i class="swatch" style="background:var(${st.v})"></i>${st.label}</div>
    ${p.cwd ? `<div class="meta">
      <span class="tag cwd">${esc(basename(p.cwd))}</span>
      ${staffOf(p) ? `<span class="tag staff" title="An employee of ${esc(theState()?.company.name ?? '')}">${esc(staffOf(p).name)} · ${esc(staffOf(p).title)}</span>` : ''}
      ${mates.length ? `<span class="tag warn" title="Also in this folder: ${esc(mates.join(', '))}. Two writing at once can undo each other's work.">⚠ shares folder with ${mates.length}</span>` : ''}
    </div>` : ''}
    ${p.isAgent ? moveButton(p) : ''}
  </${p.isAgent ? 'article' : 'div'}>`;
}

/* ── Start a new agent: pick a folder, that is the whole dialog ── */
/* Where a new agent lands. Before this existed every agent went wherever Herdr's focus
   happened to be, split sideways — which is how one project ended up spread over nine
   windows, and how a pane can get narrow enough that Claude Code quits on startup.
   A window of its own is the default because it is the only choice that cannot squeeze
   an agent already running. */
const destOptions = () => {
  const ws = theModel()?.workspaces ?? [];
  const pages = ws.flatMap((w) => w.tabs.map((t) => ({ v: `tab:${t.id}`, t: `${w.label} · ${t.label}` })));
  const group = (label, rows) => (rows.length
    ? `<optgroup label="${label}">${rows.map((r) => `<option value="${esc(r.v)}">${esc(r.t)}</option>`).join('')}</optgroup>`
    : '');
  return '<option value="new_workspace">A window of its own</option>'
    + group('Its own page in a window you already have', ws.map((w) => ({ v: `new_tab:${w.id}`, t: w.label })))
    + group('Beside the agents already on a page', pages);
};
const parseDest = (v) => {
  if (v.startsWith('new_tab:')) return { type: 'new_tab', workspaceId: v.slice(8) };
  if (v.startsWith('tab:')) return { type: 'tab', tabId: v.slice(4), split: 'down' };
  return { type: 'new_workspace' };
};

export async function openSpawn() {
  document.querySelector('.spawn-overlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay spawn-overlay';
  ov.innerHTML = `<div class="sheet spawn-sheet">
    <div class="sheet-head">
      <h3 class="display">New agent</h3>
      <div class="actions">
        <span class="flow-msg spawn-msg" role="status" aria-live="polite"></span>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="muted-note">Pick the folder it should work in. It opens in Herdr and appears on this map.</p>
    <div class="folder-list">Reading your folders…</div>
    <label class="fld"><span>Or type a full path — checked when you press Start</span>
      <input class="spawn-cwd" placeholder="C:\\Users\\you\\my-project" />
    </label>
    <label class="fld"><span>What is this one for? — this is the name you will see on the map</span>
      <input class="spawn-name" maxlength="40" placeholder="e.g. fix the ingestion page" />
    </label>
    <label class="fld"><span>Where it goes in Herdr</span>
      <select class="spawn-dest">${destOptions()}</select>
    </label>
    <div class="flow-foot">
      <button class="btn primary" data-act="start" disabled>Start agent</button>
      <span class="muted-note">Runs <code>claude</code> in that folder.</span>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const cwdBox = ov.querySelector('.spawn-cwd');
  const startBtn = ov.querySelector('[data-act="start"]');
  const setCwd = (v) => { cwdBox.value = v; startBtn.disabled = !v.trim(); };
  cwdBox.addEventListener('input', () => setCwd(cwdBox.value));

  const r = await get('/api/projects');
  const list = ov.querySelector('.folder-list');
  list.innerHTML = r.ok && r.projects.length
    ? r.projects.map((p) => `<button class="chip ${p.running ? 'on' : ''}" data-folder="${esc(p.path)}"
        title="${esc(p.path)}">${esc(p.name)}${p.running ? ' <small>running</small>' : ''}</button>`).join('')
    : `<p class="muted-note">${r.ok ? 'No project folders found — type a path below.' : esc(r.error)}</p>`;

  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return ov.remove();
    const folder = e.target.closest('[data-folder]')?.dataset.folder;
    if (folder) {
      setCwd(folder);
      for (const c of ov.querySelectorAll('[data-folder]')) c.classList.toggle('picked', c.dataset.folder === folder);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return ov.remove();
    if (act === 'start') {
      const msg = ov.querySelector('.spawn-msg');
      startBtn.disabled = true;
      msg.textContent = 'Starting…';
      const out = await post('/api/agents/start', {
        cwd: cwdBox.value.trim(),
        label: ov.querySelector('.spawn-name').value.trim(),
        dest: parseDest(ov.querySelector('.spawn-dest').value),
      });
      msg.classList.toggle('bad', !out.ok);
      msg.textContent = out.ok ? `Started ${out.label}.${out.warning ? ` ${out.warning}` : ''}` : out.error;
      startBtn.disabled = false;
      if (out.ok) { if (host) tick(); setTimeout(() => ov.remove(), 900); }
    }
  });
  (ov.querySelector('.spawn-name') ?? cwdBox).focus();
}

/* ── Closing agents: whole map from the header, one workspace from its own header ── */
async function closeAgents(workspaceId, howMany, where) {
  if (!await ask(`Close ${howMany} agent${howMany === 1 ? '' : 's'} in ${where}?`, { yes: 'Close them', danger: true, detail: 'Anything unsaved in them is lost.' })) return;
  headMsg('Closing…', { bad: false });
  // The number just agreed to travels with the request. The server counts again from Herdr
  // itself and closes nothing at all if the answer has moved on — so what is shut down is
  // always the number that was named, never one that quietly grew while the box sat open.
  const r = await post('/api/agents/close-all', { workspaceId, expect: howMany });
  // Agents that would not close are the half worth keeping on screen: they are still running,
  // so this must not tidy itself away six seconds later as though the job were finished.
  headMsg(r.ok
    ? (r.failed
      ? `Closed ${r.closed} · ${r.failed} would not close and ${r.failed === 1 ? 'is' : 'are'} still running.`
      : `Closed ${r.closed}.`)
    : r.error, { bad: !r.ok || !!r.failed, forMs: 6000 });
  tick();
}


let lastCounts = { total: 0 };

const agentsIn = (w) => w.tabs.reduce((n, t) => n + t.panes.filter((p) => p.isAgent).length, 0);
const shellsIn = (w) => w.tabs.reduce((n, t) => n + t.panes.filter((p) => !p.isAgent).length, 0);

function render(model, shared = [], board = []) {
  $('state').innerHTML = '';
  setModel(model);
  const c = lastCounts = model.counts;
  $('close-all').hidden = !c.total;
  $('counts').hidden = false;
  $('legend').hidden = false;
  // A status nobody is in is not news — only the ones with agents in them are shown.
  $('counts').innerHTML = `<b>${c.total} agent${c.total === 1 ? '' : 's'}</b>`
   + board.filter((s) => s.ids.length)
      .map((s) => `<span><i class="swatch" style="background:var(--${esc(s.tone)})"></i>${s.ids.length} ${esc(s.label)}</span>`).join('')
   // Measured 2026-09-01: four agents had the same folder (project-a) and the map showed
   // it nowhere, because cards are grouped by Herdr window and the four sat in four boxes.
   // It is a standing condition, not an event, and the cards already carry the ⚠ — so it is
   // a chip on this line rather than a band of its own, with the sentence in its tooltip.
   + (shared.length ? `<span class="tag warn" title="Two agents writing to the same files at
      once can undo each other's work. The cards in those folders are marked ⚠.">⚠ ${shared.length}
      folder${shared.length === 1 ? '' : 's'} shared</span>` : '')
   // What to do with them, beside the count of them — a sentence in the page footer was
   // measured at y=1570 on a 900px screen, below every card, and never read.
   + '<span class="how">Click one to read and answer it · employees are tagged with their role</span>';

  sharedBy = new Map(shared.flatMap((f) =>
    f.agents.map((a) => [a.id, f.agents.filter((o) => o.id !== a.id).map((o) => o.label)])));

  // The separate "needs you" lane is gone from the markup. It existed because cards were
  // grouped by window and the ones wanting an answer were scattered; the first column now IS
  // that lane, so keeping both drew every waiting agent twice. It was left hidden rather than
  // removed, and its <h2> still sat between the page's h1 and the columns' h3s in the
  // document — a heading level for a section nobody can see (axe heading-order, 2026-09-02).

  const anyAgents = c.total > 0 || model.workspaces.some(w => w.tabs.some(t => t.panes.length));
  if (!anyAgents) {
    $('workspaces').innerHTML = '';
    $('state').innerHTML = emptyState();
    return;
  }
  // ── The board ──
  // One column per state, in the order config.json lists them, and a card sits in one because
  // of what Herdr reports about it — never because anything put it there. The columns, their
  // wording and their colours all arrive from the server (src/state.mjs); nothing is decided
  // here, so the board cannot disagree with the terminal.
  //
  // This replaced one box per Herdr *window* — a grouping that came from the accident of how
  // the terminals were opened. Measured 2026-09-02: one folder was drawn as five boxes named
  // "project-a Qs", "project-a (3)", "featsLogi-Add" and so on, and the agents actually
  // waiting for an answer were scattered across all five.
  const paneById = new Map(model.workspaces.flatMap((w) =>
    w.tabs.flatMap((t) => t.panes.map((p) => [p.id, p]))));
  // A shell is not an agent, so no state describes it. It keeps its own quiet row rather than
  // being forced into a column where the word on the heading would not be true of it.
  const shells = [...paneById.values()].filter((p) => !p.isAgent);

  // Width is earned, not equal. A column with nine agents in it and a column with one do not
  // want the same width: the busy one turns into a long scroll and the quiet one is mostly
  // empty. Each column gets a number of lanes worked out from how many cards it holds (the
  // sums are in src/state.mjs, the numbers in config.json), and its cards spread across them.
  const width = board.map((c) => c.lanes ?? 1);
  // An empty column is a slim tab, not a lane: it still says its name, so "nothing needs
  // you" is read, but the width goes to the columns with cards in them.
  const tracks = board.map((c, i) => (c.ids.length ? `minmax(0,${width[i]}fr)` : 'auto')).join(' ');

  morphBoard($('workspaces'), `<div class="board" style="grid-template-columns:${tracks}">${board.map((col, i) => `
    <section class="col tone-${esc(col.tone)} ${col.ids.length ? '' : 'col-empty'}" data-col="${esc(col.id)}" style="--w:${width[i]}">
      <div class="col-head">
        <i class="swatch" style="background:var(--${esc(col.tone)})"></i>
        <h2>${esc(col.label)}</h2>
        <span class="badge">${col.ids.length}</span>
      </div>
      <p class="col-why">${esc(col.blurb ?? '')}</p>
      ${col.ids.length
        ? `<div class="panes">${col.ids.map((id) => card(paneById.get(id))).join('')}</div>`
        // An empty column is an answer, not a gap: "nothing needs you" is the thing you opened
        // the page to find out. A blank space instead reads as something that failed to load.
        : '<p class="col-none">Nobody here.</p>'}
    </section>`).join('')}</div>
    ${shells.length ? `<section class="col shells" data-col="__shells">
      <div class="col-head"><i class="swatch" style="background:var(--unknown)"></i>
        <h2>Terminals</h2><span class="badge">${shells.length}</span></div>
      <p class="col-why">Open, with no agent running in them.</p>
      <div class="panes">${shells.map(card).join('')}</div>
    </section>` : ''}`);
}

/* ── Agents stopped on the same question ──
   Reading each screen costs a call per agent, so it runs on its own slower clock than the
   map. Each button says how many agents it answers, and pressing one walks every one of
   them to that answer on its own screen — the same answer can be a different row on each. */
let waitingSig = '';
function renderWaiting(waiting) {
  const bar = $('waiting');
  // Same answer as last scan: leave the bar alone, so a button you are about to press
  // is not rebuilt under the pointer.
  const sig = JSON.stringify(waiting);
  if (sig === waitingSig) return;
  waitingSig = sig;
  if (!waiting.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = waiting.map((w) => {
    const n = w.agents.length;
    const who = w.agents.map((a) => esc(a.label)).join(' · ');
    return `<div class="wait-row" data-prompt="${esc(w.id)}">
      <p class="wait-sum"><b>${n} agent${n === 1 ? ' is' : 's are'}</b> waiting on the same question — ${esc(w.title)}</p>
      <div class="wait-picks">
        ${w.choices.map((c, i) => `<button class="btn ${i === 0 ? 'primary' : ''}"
          data-answer="${esc(c.id)}" data-label="${esc(c.label)}" data-count="${c.count}"
          >${esc(c.label)} <small>· all ${c.count}</small></button>`).join('')}
      </div>
      <p class="wait-who">${who}</p>
    </div>`;
  }).join('');
}

async function scanPrompts() {
  if (document.hidden || !host) return;
  const r = await get('/api/prompts');
  if (r.ok) renderWaiting(r.waiting);
}

async function onWaitingClick(e) {
  const btn = e.target.closest('[data-answer]');
  if (!btn) return;
  const row = btn.closest('[data-prompt]');
  // One click here types an answer into several live agents at once, so it asks first, and
  // names both the words being sent and how many agents will get them.
  const n = Number(btn.dataset.count);
  if (!await ask(`Answer “${btn.dataset.label}” on ${n} agent${n === 1 ? '' : 's'} now?`, { yes: 'Answer all', detail: "Each one is typed into that agent's own screen." })) return;
  for (const b of row.querySelectorAll('[data-answer]')) b.disabled = true;
  headMsg('Answering…', { bad: false });
  // The number just agreed to travels with the request, exactly as closing's does: the server
  // looks again and answers nobody if more agents have arrived on the question since.
  const r = await post('/api/prompts/answer',
    { promptId: row.dataset.prompt, choiceId: btn.dataset.answer, expect: n });
  // An agent that would not take the answer is still sitting on the question, so that stays
  // up. Only a run where every agent took it is allowed to clear itself.
  headMsg(r.ok
    ? (r.failed
      ? `Answered ${r.answered} · ${r.failed} would not take it and ${r.failed === 1 ? 'is' : 'are'} still on the question.`
      : `Answered ${r.answered}.`)
    : r.error, { bad: !r.ok || !!r.failed, forMs: 6000 });
  setTimeout(scanPrompts, 900);
  tick();
}

const emptyState = () => `<div class="state">
  <div class="display">Your workspace is quiet</div>
  <p>Herdr is connected, but no agents are running yet.</p>
  <p class="hint">Start your company from the Dashboard and its employees appear here — or press <b>N</b> for a plain agent.</p>
  <button class="btn" data-help>Show me how this page works</button>
</div>`;

const errorState = (msg) => `<div class="state">
  <div class="display">Waiting for Herdr</div>
  <p>${esc(msg)}</p>
  <p class="hint">This page keeps trying every ${(pollMs/1000).toFixed(1)}s. The moment Herdr is up, the map appears.</p>
</div>`;

const loadingState = () => `<div class="state"><div class="spin"></div><p>Reading your agents…</p></div>`;

let lastDrawnSig = '';   // what the last drawn board was made of, so an unchanged poll draws nothing

async function tick() {
  if (!host) return;
  const data = await get('/api/snapshot');
  if (!host) return;
  if (!data.ok) { setLive(false, 'offline'); renderState(errorState(data.error)); return; }
  setLive(true, 'live');
  /* ── Only redraw when something actually changed ──
     The map is read every 1.5s and the whole board used to be rebuilt each time, whether
     anything had moved or not. Every card was destroyed and remade forty times a minute, so
     the page visibly flickered while you were reading it, and anything mid-gesture — a hover,
     a half-drawn line — was thrown away with it.
     The signature is everything the drawing depends on, plus which minute it is: the cards
     say how long an agent has been in its state, so a still board still refreshes once a
     minute rather than never. */
  const sig = JSON.stringify([
    data.board, data.shared,
    data.model.workspaces.map((w) => [w.id, w.label, w.focused, w.tabs.map((t) => [t.id, t.label,
      t.panes.map((p) => [p.id, p.label, p.title, p.status, p.cwd, p.isAgent, p.focused])])]),
  ]);
  if (sig === lastDrawnSig) return;
  lastDrawnSig = sig;
  render(data.model, data.shared ?? [], data.board ?? []);
}

const skeleton = `<div class="page-head"><h2 class="display">Agents</h2>
    <div class="actions"><button class="btn" data-act="spawn" title="Start a plain agent in a folder (N)">＋ New agent</button></div></div>
  <section class="counts" id="counts" hidden></section>
  <section class="waiting" id="waiting" hidden></section>
  <div class="workspaces" id="workspaces"></div>
  <div id="state"></div>
  <div class="legend" id="legend" hidden>
    <span><i class="swatch" style="background:var(--unknown)"></i>Shell · not an agent</span>
    <span><b style="color:var(--gold)">★</b> Focused in Herdr</span>
    <button class="btn danger" id="close-all" hidden>Close all agents</button>
  </div>`;

/** Draw the map into `el` and keep it live until stopMap(). */
export async function startMap(el, cfg = {}) {
  stopMap();
  host = el;
  pollMs = cfg.pollIntervalMs || 1500;
  promptScanMs = cfg.promptScanMs || 5000;
  lastDrawnSig = '';
  waitingSig = '';
  el.innerHTML = skeleton;
  $('state').innerHTML = loadingState();
  $('close-all').addEventListener('click', () => closeAgents(null, lastCounts.total, 'the whole map'));
  $('waiting').addEventListener('click', onWaitingClick);
  el.querySelector('[data-act="spawn"]').addEventListener('click', () => openSpawn());
  await tick();
  await scanPrompts();
  timers = [setInterval(tick, pollMs), setInterval(scanPrompts, promptScanMs)];
}

export function stopMap() {
  for (const t of timers) clearInterval(t);
  timers = [];
  host = null;
}

/** Called by the page when the window regains focus. */
export const refreshMap = () => { if (host) { tick(); scanPrompts(); } };
onOverlayEscape('.spawn-overlay', () => document.querySelector('.spawn-overlay')?.remove());
