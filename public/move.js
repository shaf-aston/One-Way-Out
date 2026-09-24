// Moving an agent to somewhere else in Herdr, from the map.
//
// The agent keeps its terminal and its whole conversation — measured, not assumed (spike S0,
// 2026-08-22: same terminal id and same session id across all three destinations).
//
// One button, one menu, and the menu item IS the confirmation: every line says the agent's
// name and where it is going in full words, so choosing one is consenting to it. Nothing here
// opens a second dialog to ask the same question again.
import { esc, post, menuAt, headMsg, theModel } from './ui.js';
import { bindKey } from './keys.js';

/** Where an agent sits right now: its window and its page. */
function whereIs(paneId) {
  for (const w of theModel()?.workspaces ?? []) {
    for (const t of w.tabs) {
      const p = t.panes.find((x) => x.id === paneId);
      if (p) return { pane: p, tab: t, ws: w };
    }
  }
  return null;
}

/** The destinations that make sense for this agent — never the page it is already on. */
function options(here) {
  const ws = theModel()?.workspaces ?? [];
  const alone = here.tab.panes.length === 1;                 // nothing else on its page
  const ownWindow = alone && here.ws.tabs.length === 1;      // and nothing else in its window
  const items = ownWindow ? [] : [{ key: 'new_workspace', label: 'To a window of its own' }];

  // Offering "its own page" in the window it is already alone in would do nothing.
  const pages = ws.filter((w) => !(w.id === here.ws.id && alone))
    .map((w) => ({ key: `new_tab:${w.id}`, label: w.label }));
  if (pages.length) items.push({ head: 'To its own page in' }, ...pages);

  const beside = ws.flatMap((w) => w.tabs
    .filter((t) => t.id !== here.tab.id)
    .map((t) => ({ key: `tab:${t.id}`, label: `${w.label} · ${t.label}` })));
  if (beside.length) items.push({ head: 'Beside the agents on' }, ...beside);

  return items;
}

/** A menu key back into the destination shape src/moves.mjs checks. */
const destOf = (key) => {
  if (key.startsWith('new_tab:')) return { type: 'new_tab', workspaceId: key.slice(8) };
  // Down, never sideways: repeated sideways splits make a pane narrow enough that Claude
  // Code quits the moment it starts (measured 2026-08-22).
  if (key.startsWith('tab:')) return { type: 'tab', tabId: key.slice(4), split: 'down' };
  return { type: 'new_workspace' };
};

/** Open the move menu for one agent, at a point on screen. */
export function openMoveMenu(paneId, at) {
  const here = whereIs(paneId);
  if (!here) return headMsg('That agent is no longer on the map.');
  const name = here.pane.label;
  menuAt(at, `Where should ${name} go?`, [{ head: `Move ${name}` }, ...options(here)], async (key) => {
    headMsg(`Moving ${name}…`, { bad: false });
    const r = await post('/api/pane/move', { id: paneId, dest: destOf(key) });
    // A move that quietly restarted the agent comes back as a failure, not a success — the
    // server compares the terminal id either side. Either way you are told which happened.
    headMsg(r.ok ? '' : r.error);
    if (r.ok) headMsg(`${name} moved.`, { bad: false });
  });
}

/** Where a menu should appear for a card reached by keyboard rather than by pointer. */
const underCard = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 6 };
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-move]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();          // this click moves an agent; it must not also open its screen
  openMoveMenu(btn.dataset.move, { x: e.clientX, y: e.clientY });
});

// Keyboard parity: M on a focused agent card opens the same menu in the same place a
// pointer would have put it. Everything the mouse can do here, the keyboard can do too.
bindKey('move', () => {
  const card = document.activeElement?.closest('.card[data-pane]');
  if (card) openMoveMenu(card.dataset.pane, underCard(card));
});

/** The button drawn on every agent card. Kept here so its wording lives beside its behaviour. */
export const moveButton = (p) => `<button class="mover" data-move="${esc(p.id)}"
  title="Move ${esc(p.label)} to another window or page (M)"
  aria-label="Move ${esc(p.label)} to another window or page">⇄</button>`;
