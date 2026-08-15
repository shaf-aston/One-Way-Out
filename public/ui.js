// Shared view helpers: DOM, escaping, fetch, and the slash-command palette.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
export const basename = (p) => p ? p.replace(/[/\\]+$/,'').split(/[/\\]/).pop() : '';

/**
 * The one line in the header where the page speaks. Every part of the app says things here,
 * so it says them the same way: passing `bad` marks it as a problem, and clearing the text
 * clears the mark too — otherwise the red outlives the message that earned it.
 */
export function headMsg(text, { bad = !!text } = {}) {
  const el = $('head-msg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('bad', !!text && bad);
}

/**
 * Flatten the map model to just its agents — the roster both panels pick from.
 * Every agent running `claude` is called "Claude", so two of them are indistinguishable in a
 * list. Where a name repeats, the folder is folded into it: "Claude · blotter".
 */
export function agentsOf(m) {
  const all = (m?.workspaces ?? []).flatMap((w) => w.tabs.flatMap((t) => t.panes
    .filter((p) => p.isAgent)
    .map((p) => ({ id: p.id, label: p.label, cwd: p.cwd, workspace: w.label }))));
  const seen = new Map();
  for (const a of all) seen.set(a.label, (seen.get(a.label) ?? 0) + 1);
  return all.map((a) => (seen.get(a.label) > 1
    ? { ...a, label: `${a.label} · ${basename(a.cwd) || a.workspace}` }
    : a));
}

export async function get(path) {
  try { return await (await fetch(path, { cache:'no-store' })).json(); }
  catch (e) { return { ok:false, error:'Cannot reach the Herdr Map server.' }; }
}

export async function post(path, body) {
  try {
    return await (await fetch(path, {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body),
    })).json();
  } catch (e) { return { ok:false, error:'Cannot reach the Herdr Map server.' }; }
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
 * Escape closes the top overlay. Registered ONCE per panel at load time — the old code added
 * a fresh listener on every open and only ever removed the one that fired, so they piled up.
 * @param {string} selector - the overlay this panel owns
 * @param {() => void} close
 */
export function onOverlayEscape(selector, close) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.querySelector(selector)) return;
    if (document.querySelector('.palette:not([hidden])')) return;
    close();
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
export function clean(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/[─-╿]{3,}/g, '').replace(/\s+$/, ''))
    .filter((l, i, a) => l.trim() || (a[i - 1] ?? '').trim())
    .join('\n')
    .trim();
}
