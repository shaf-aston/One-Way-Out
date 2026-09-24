// Shared view helpers: DOM, escaping, fetch, and the slash-command palette.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
export const basename = (p) => p ? p.replace(/[/\\]+$/,'').split(/[/\\]/).pop() : '';

/**
 * The one line in the header where the page speaks. Every part of the app says things here,
 * so it says them the same way: passing `bad` marks it as a problem, and clearing the text
 * clears the mark too — otherwise the red outlives the message that earned it.
 *
 * A confirmation and a problem are not the same kind of thing. A confirmation may be handed
 * `forMs` and tidy itself away after that long; a problem never does, whatever it is handed —
 * it stays until the page speaks again or you click it. Two callers used to delete their own
 * line after six seconds regardless, so "3 would not close" disappeared while those three
 * agents were still running.
 *
 * @param {string} text - what to say, in plain words. Empty clears the line.
 * @param {{bad?:boolean, forMs?:number}} opts - `bad` marks it a problem; `forMs` is how long
 *   a confirmation lingers, and is ignored outright for a problem.
 */
let msgTimer = null, msgClickable = false;
export function headMsg(text, { bad = !!text, forMs = 0 } = {}) {
  const el = $('head-msg');
  if (!el) return;
  if (!msgClickable) { msgClickable = true; el.addEventListener('click', () => headMsg('')); }
  clearTimeout(msgTimer);
  const problem = !!text && bad;
  el.textContent = text || '';
  el.classList.toggle('bad', problem);
  el.title = problem ? 'Click when you have read this. It does not undo or retry anything.' : '';
  if (text && !problem && forMs > 0) msgTimer = setTimeout(() => headMsg(''), forMs);
}

/* ── The latest map, in one place ──
   The map is polled in index.html and read by every panel. It lives here, with the other
   shared view helpers, so no panel has to import it from another panel. */
let latest = null;
export const setModel = (m) => { latest = m; };
export const theModel = () => latest;

/**
 * Flatten the map model to just its agents — the roster both panels pick from.
 * Every agent running `claude` is called "Claude", so two of them are indistinguishable in a
 * list. Where a name repeats, the folder is folded into it: "Claude · blotter".
 */
export function agentsOf(m) {
  const all = (m?.workspaces ?? []).flatMap((w) => w.tabs.flatMap((t) => t.panes
    .filter((p) => p.isAgent)
    .map((p) => ({ id: p.id, session: p.session, label: p.label, cwd: p.cwd, workspace: w.label }))));
  const seen = new Map();
  for (const a of all) seen.set(a.label, (seen.get(a.label) ?? 0) + 1);
  return all.map((a) => (seen.get(a.label) > 1
    ? { ...a, label: `${a.label} · ${basename(a.cwd) || a.workspace}` }
    : a));
}

export async function get(path) {
  try { return await (await fetch(path, { cache:'no-store' })).json(); }
  catch (e) { return { ok:false, error:'Cannot reach the One-Way-Out server.' }; }
}

export async function post(path, body) {
  try {
    return await (await fetch(path, {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body),
    })).json();
  } catch (e) { return { ok:false, error:'Cannot reach the One-Way-Out server.' }; }
}

/**
 * Ask before anything that reaches a live agent. One place, so every such action asks the
 * same way — and so there is exactly one line to change if this ever becomes a real dialog.
 */
export const confirmOnce = (question) => window.confirm(question);

/**
 * Guard every exit from a panel you have typed into. Losing a half-written job because you
 * clicked the backdrop is the single easiest way to make someone distrust an app.
 * @param {boolean} dirty - is there work on screen that is not saved or sent?
 */
export const okToDiscard = (dirty, what = 'what you typed') =>
  !dirty || window.confirm(`Throw away ${what}?`);

/**
 * A small menu at a point on screen. The one menu this app has: connecting agents and moving
 * them both open it, so there is a single set of keyboard, edge-flipping and dismissal rules
 * rather than one per feature.
 *
 * Choosing an item IS the confirmation — each label says what will happen in full words, so
 * nothing here opens a second dialog to ask again.
 *
 * @param {{x:number,y:number}} at - where to put it; it flips back inside near an edge
 * @param {string} title - what the choice is about, read out to screen readers
 * @param {Array<{key:string,label:string,blurb?:string,cls?:string,head?:string}>} items
 *   `head` starts a labelled section; an item with no `key` is not clickable.
 * @param {(key:string) => void} pick
 */
export function menuAt(at, title, items, pick) {
  document.querySelector('.kind-menu')?.remove();
  const rows = items.filter(Boolean);
  if (!rows.length) return;
  const m = document.createElement('div');
  m.className = 'kind-menu';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', title);
  m.innerHTML = rows.map((it) => (it.head
    ? `<p class="menu-head">${esc(it.head)}</p>`
    : `<button role="menuitem" class="${esc(it.cls ?? '')}" data-pick="${esc(it.key)}">${esc(it.label)}${
      it.blurb ? `<small>${esc(it.blurb)}</small>` : ''}</button>`)).join('');
  document.body.appendChild(m);
  // Keep it on screen: a menu opened near the right or bottom edge flips back inside.
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(at.y, innerHeight - r.height - 8))}px`;
  m.querySelector('button')?.focus();
  const shut = () => { m.remove(); removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!e.target.closest('.kind-menu')) shut(); };
  setTimeout(() => addEventListener('pointerdown', away, true));
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { shut(); headMsg(''); } });
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    shut();
    pick(b.dataset.pick);
  });
}

/* ── Escape closes the panel on top ──
   ONE listener for the whole page, holding a list of panels — not a listener each. Each panel
   used to add its own and check only that its own overlay was there, so a single press closed
   every open panel at once: measured 2026-09-02, Escape over the help sheet also threw away
   the New agent form underneath it and everything typed into it.
   Asking each listener "am I the top one?" does not fix that, and that is the trap worth
   writing down: the first listener to run closes itself, and by the time the next one asks,
   it IS the top one. So the top is decided once, from the panels that were open before
   anything moved. */
const panels = [];
let listening = false;

/**
 * Let a panel be closed by Escape when it is the one on top. Called ONCE per panel at load
 * time — the original code added a fresh listener on every open and only ever removed the one
 * that fired, so they piled up.
 * @param {string} selector - the overlay this panel owns
 * @param {() => void} close
 */
export function onOverlayEscape(selector, close) {
  panels.push({ selector, close });
  // The listener is added when the first panel asks for one, never at import: the pure
  // helpers in this file are also imported outside a browser by npm run verify, where
  // there is no document to listen on.
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.palette:not([hidden])')) return;
    const open = panels
      .map((p) => ({ close: p.close, el: document.querySelector(p.selector) }))
      .filter((p) => p.el);
    if (!open.length) return;
    // Last in the page is the one drawn on top of the others.
    open.sort((a, b) =>
      (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    open[open.length - 1].close();
  });
}

/** Grow a textarea to fit its content, up to `maxPx`. */
export function autoGrow(el, maxPx = 200) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
}

const cache = new Map(); // cwd -> commands, so the list is fetched once per project

/**
 * Attach live "/" completion to a textarea. The list is whatever commands and skills
 * exist on this machine for that folder — nothing about them is hardcoded here.
 * @param {HTMLTextAreaElement} el
 * @param {() => string|null} getCwd - the agent's working folder, read at open time.
 */
export function attachPalette(el, getCwd) {
  const menu = document.createElement('div');
  menu.className = 'palette';
  menu.hidden = true;
  el.insertAdjacentElement('afterend', menu);
  let items = [], active = 0;

  const token = () => {
    const upto = el.value.slice(0, el.selectionStart);
    const m = /(^|\s)(\/[\w:-]*)$/.exec(upto);
    return m ? m[2] : null;
  };

  const hide = () => { menu.hidden = true; items = []; };

  const draw = () => {
    if (!items.length) return hide();
    menu.innerHTML = items.map((c, i) => `
      <button type="button" class="palette-item ${i === active ? 'on' : ''}" data-i="${i}">
        <span class="pname">${esc(c.name)}</span>
        <span class="pdesc">${esc(c.desc)}</span>
        <span class="pkind">${esc(c.kind === 'skill' ? 'skill' : c.source)}</span>
      </button>`).join('');
    menu.hidden = false;
    menu.querySelector('.on')?.scrollIntoView({ block:'nearest' });
  };

  const load = async () => {
    const cwd = getCwd() || '';
    if (!cache.has(cwd)) {
      const r = await get(`/api/commands?cwd=${encodeURIComponent(cwd)}`);
      cache.set(cwd, r.ok ? r.commands : []);
    }
    return cache.get(cwd);
  };

  const refresh = async () => {
    const t = token();
    if (t === null) return hide();
    const all = await load();
    const q = t.slice(1).toLowerCase();
    items = all.filter((c) => c.name.slice(1).toLowerCase().includes(q)).slice(0, 8);
    active = 0;
    draw();
  };

  const choose = (i) => {
    const c = items[i];
    if (!c) return;
    const start = el.selectionStart;
    const before = el.value.slice(0, start).replace(/(\/[\w:-]*)$/, `${c.name} `);
    el.value = before + el.value.slice(start);
    el.selectionStart = el.selectionEnd = before.length;
    hide();
    el.focus();
    autoGrow(el);
  };

  el.addEventListener('input', refresh);
  el.addEventListener('blur', () => setTimeout(hide, 150));
  menu.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-i]');
    if (btn) { e.preventDefault(); choose(Number(btn.dataset.i)); }
  });
  el.addEventListener('keydown', (e) => {
    if (menu.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; draw(); }
    else if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  }, true);

  return { isOpen: () => !menu.hidden };
}

/**
 * Tidy the agent's screen text for reading at browser width.
 * Terminals pad every line out to their own column width and draw rules out of box
 * characters; both look like damage once the text is re-wrapped. Presentational only —
 * it drops padding and rules, never words, so it cannot show you something that isn't there.
 */
const TABLE_RULE = /^(?:\s|\x1b\[[\d;]*m)*[┌├└][─┬┼┴┐┤┘]+(?:\s|\x1b\[[\d;]*m)*$/u;
export function clean(text) {
  return String(text ?? '')
    .split('\n')
    // Padding sits BEFORE the row's closing colour code, so trailing spaces are trimmed
    // through any escape codes that follow them.
    // A table's own ┌├└ border stays: it is what tells the reader where one row ends.
    .map((l) => (TABLE_RULE.test(l) ? l : l.replace(/[─-╿]{3,}/g, '')).replace(/\s+((?:\x1b\[[\d;]*m)*)$/, '$1'))
    .filter((l, i, a) => l.trim() || (a[i - 1] ?? '').trim())
    .join('\n')
    .trim();
}
