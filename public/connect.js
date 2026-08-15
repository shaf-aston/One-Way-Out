// Drawing connections between agents, right on the map.
//
// Every agent card carries a dot. Drag it to another agent and a menu asks what the
// connection means at the spot you dropped it — there is no mode to remember and nowhere
// else to go. The lines themselves live in wires.js; this file is only how you draw them
// and the bar that acts on them.
import { $, esc, autoGrow, confirmOnce, headMsg } from './ui.js';
import { addWire, wires, removeWire, setWireKind, clearWires, kindList, groupCount, sendJob, loadKinds } from './wires.js';

/* ── Connect agents on the map, without going anywhere ──
   Every agent card has a dot on its edge. Drag it to another agent — or click it, then
   click the other agent — and a labelled arrow appears between them. That arrow IS a line
   between them, and a small menu asks what the connection means right where you dropped it.
   There is no mode to remember and nowhere else to go: this page is the only place agents
   are connected. Click a line's label to change what it means or remove it. */
let wiring = null;                       // { from, x, y, dragging }

/** Is a line half-drawn right now? A card click means "finish it", not "open the agent". */
export const isWiring = () => !!wiring;

const cardEl = (id) => document.querySelector(`.card[data-pane="${CSS.escape(id)}"]`);
const nameOf = (id) => cardEl(id)?.dataset.label ?? id;

/** Where a line leaves a card: the middle of whichever side faces the other end. */
function edge(r, to) {
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const dx = to.x - cx, dy = to.y - cy;
  return Math.abs(dx) * r.height > Math.abs(dy) * r.width
    ? { x: cx + Math.sign(dx) * r.width / 2, y: cy }
    : { x: cx, y: cy + Math.sign(dy) * r.height / 2 };
}

/** Redraw every line. Called after any repaint of the map, and on resize and scroll. */
export function drawLinks() {
  const svg = $('link-layer');       // the arrowhead lives in <defs> beside it, so it survives
  if (!svg) return;
  const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const box = (id) => cardEl(id)?.getBoundingClientRect() ?? null;
  const curve = (a, b) => `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;
  const arrow = ' marker-end="url(#head)"';
  const parts = [];

  // A view fills the page and the map is a rail beside it — the cards there are too small
  // to carry lines, so none are drawn until you are back on the map.
  if (!document.body.classList.contains('in-view')) {
    for (const w of wires()) {
      const ra = box(w.from), rb = box(w.to);
      if (!ra || !rb) continue;             // one end is not on screen: draw nothing rather than a lie
      const a = edge(ra, mid(rb)), b = edge(rb, mid(ra));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 7;
      // Both handles are real buttons: a line drawn with the mouse is still changeable
      // and removable from the keyboard.
      const names = `${nameOf(w.from)} to ${nameOf(w.to)}`;
      parts.push(`<g><path d="${curve(a, b)}"${arrow}/>
        <text x="${mx}" y="${my}" text-anchor="middle" role="button" tabindex="0" data-wire="${w.i}"
          aria-label="${esc(w.label)}: ${esc(names)}. Change or remove this connection"><title>Change or remove this connection</title>${esc(w.label)}</text></g>`);
    }
  }
  const ra = wiring && box(wiring.from);
  if (ra) parts.push(`<g class="ghost"><path d="${curve(edge(ra, wiring), wiring)}"${arrow}/></g>`);
  svg.innerHTML = parts.join('');
  paintWired();
}

/** The send bar, which only exists while there is something to send to. */
function paintWired() {
  const n = wires().length;
  $('wired').hidden = !n || document.body.classList.contains('in-view');
  if (!n) return;
  const g = groupCount();
  $('wired-sum').textContent =
    `${n} connection${n === 1 ? '' : 's'} · ${g} group${g === 1 ? '' : 's'} of agents. `
    + 'Sending gives every group the same job, each agent told its own part.';
}

const stopWiring = () => { wiring = null; document.body.classList.remove('wiring'); drawLinks(); };

/**
 * Finish a connection on the agent under the pointer, or wherever the keyboard is.
 * The kind is asked for at the drop, so a line never quietly means something you did not pick.
 */
function joinTo(to, at) {
  const from = wiring?.from;
  stopWiring();
  if (!to || !from) return;
  if (from === to) return headMsg('Connect it to a different agent.');
  headMsg('');
  askKind(at, `How should ${nameOf(from)} and ${nameOf(to)} work together?`, (kind) => {
    const r = addWire(from, to, kind);
    if (!r.ok) headMsg(r.error);
    drawLinks();
  });
}

/**
 * Land a half-drawn line on an agent chosen with the keyboard. The menu needs somewhere to
 * appear, so it opens under that agent's own card rather than wherever the mouse happens to be.
 */
export function finishFromKeyboard(to) {
  const r = cardEl(to)?.getBoundingClientRect();
  joinTo(to, r ? { x: r.left, y: r.bottom + 6 } : { x: innerWidth / 2, y: innerHeight / 2 });
}

/**
 * The little menu that names the three kinds in full words. It is the only place a kind is
 * ever chosen, so there is nothing to remember between one line and the next.
 * @param {{x:number,y:number}} at - where on screen to put it
 * @param {string} title - what the choice is about
 * @param {(kind:string) => void} pick - what to do with the answer
 * @param {() => void} [onDrop] - if given, the menu also offers to remove the line
 */
function askKind(at, title, pick, onDrop) {
  document.querySelector('.kind-menu')?.remove();
  const kinds = kindList();
  if (!kinds.length) return pick('manages');    // the server has not answered yet: use the safe one
  const m = document.createElement('div');
  m.className = 'kind-menu';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', title);
  m.innerHTML = kinds.map((k) => `<button role="menuitem" data-pick="${esc(k.key)}">${esc(k.label)}<small>${esc(k.blurb)}</small></button>`).join('')
    + (onDrop ? '<button role="menuitem" class="drop" data-pick="">Remove this connection</button>' : '');
  document.body.appendChild(m);
  // Keep it on screen: a menu opened near the right or bottom edge flips back inside.
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(at.y, innerHeight - r.height - 8))}px`;
  m.querySelector('button').focus();
  const shut = () => { m.remove(); removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!e.target.closest('.kind-menu')) shut(); };
  setTimeout(() => addEventListener('pointerdown', away, true));
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { shut(); headMsg(''); } });
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    shut();
    b.dataset.pick ? pick(b.dataset.pick) : onDrop();
  });
}

document.addEventListener('pointerdown', (e) => {
  const port = e.target.closest('[data-port]');
  if (!port) return;
  e.preventDefault();
  // A drag and a click are the same gesture here: let go over another agent and it connects,
  // let go where you started and the line stays armed for a second click. Either works.
  wiring = { from: port.dataset.port, x: e.clientX, y: e.clientY, dragging: false };
  document.body.classList.add('wiring');
  port.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!wiring) return;
    if (Math.hypot(ev.clientX - wiring.x, ev.clientY - wiring.y) > 4) wiring.dragging = true;
    wiring.x = ev.clientX; wiring.y = ev.clientY;
    drawLinks();
  };
  const up = (ev) => {
    port.removeEventListener('pointermove', move);
    port.removeEventListener('pointerup', up);
    port.removeEventListener('pointercancel', up);
    if (!wiring?.dragging) return;                       // armed — a second click finishes it
    joinTo(document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.card[data-pane]')?.dataset.pane,
      { x: ev.clientX, y: ev.clientY });
  };
  port.addEventListener('pointermove', move);
  port.addEventListener('pointerup', up);
  port.addEventListener('pointercancel', up);
  drawLinks();
});

// While a line is armed it follows the pointer, and the next click lands it.
document.addEventListener('pointermove', (e) => {
  if (!wiring || wiring.dragging) return;
  wiring.x = e.clientX; wiring.y = e.clientY;
  drawLinks();
});
document.addEventListener('click', (e) => {
  if (!wiring || e.target.closest('[data-port]')) return;
  // This click was spent finishing (or cancelling) the line — it must not also open a card.
  const to = e.target.closest('.card[data-pane]')?.dataset.pane;
  e.stopPropagation();
  e.preventDefault();
  joinTo(to, { x: e.clientX, y: e.clientY });
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wiring) stopWiring(); });

// A line's own label: the same menu, now also offering to remove it.
const onLink = (e) => {
  const el = e.target.closest('[data-wire]');
  if (!el) return;
  const i = +el.dataset.wire;
  const r = el.getBoundingClientRect();
  askKind({ x: r.left, y: r.bottom + 6 }, 'What does this connection mean?',
    (k) => { setWireKind(i, k); drawLinks(); },
    () => { removeWire(i); drawLinks(); });
};
$('links').addEventListener('click', onLink);
$('links').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  onLink(e);
});

/* ── What the lines are for ── */
$('wired-task').addEventListener('input', (e) => autoGrow(e.target));
$('wired-clear').addEventListener('click', () => {
  if (!confirmOnce('Remove every line? The agents themselves are not touched.')) return;
  clearWires();
  drawLinks();
});
$('wired-send').addEventListener('click', async () => {
  const box = $('wired-task');
  const task = box.value.trim();
  if (!task) return headMsg('Type the job first.');
  const g = groupCount();
  if (!confirmOnce(`Send this job to ${g} connected ${g === 1 ? 'group' : 'groups'} of agents now?`)) return;
  headMsg('Sending…');
  const r = await sendJob(task);
  if (!r.ok) return headMsg(r.error);
  box.value = '';
  autoGrow(box);
  headMsg('');
  $('wired-sum').textContent = `Sent to ${r.sent} agent${r.sent === 1 ? '' : 's'}.`
    + (r.gone ? ` ${r.gone} connected agent${r.gone === 1 ? ' is' : 's are'} no longer running.` : '');
});

addEventListener('resize', drawLinks);
addEventListener('scroll', drawLinks, true);
loadKinds().then(drawLinks);
