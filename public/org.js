// The fleet as a chain of command: who leads whom, who hands work to whom, drawn in tiers.
//
// This is the same set of agents and the same connections as the map — only arranged by rank
// instead of by which Herdr window they sit in. Nothing here is inferred: the tiers come from
// lines you drew, or from a ready-made shape you applied in one click and can then edit.
//
// The arrows themselves are drawn by connect.js, over these cards, so there is one line-drawing
// implementation in the app rather than two that can disagree.
import { esc, get, post, theModel, agentsOf, menuAt, headMsg, confirmOnce } from './ui.js';
import { wires, setWires, addWire, removeWire, kindList } from './wires.js';
import { drawLinks } from './connect.js';
import { tiersOf } from './tiers.js';

let presets = [];

/** Close means close, and nothing else. Navigating away is the page's job (index.html), which
 *  also has to be able to close this panel on its way to another view. */
const closeOrg = () => { document.querySelector('.org-overlay')?.remove(); };

/** What each row is called, in plain words rather than a rank number. */
const rowName = (i, total) => {
  if (i === 0) return total === 1 ? 'Connected' : 'In charge';
  if (i === 1) return 'One step down';
  return `${i} steps down`;
};

const agentCard = (a) => `<div class="card agent-click org-card" role="button" tabindex="0"
  data-pane="${esc(a.id)}" data-label="${esc(a.label)}" data-cwd="${esc(a.cwd ?? '')}"
  title="${esc(a.cwd ?? '')}">
  <div class="top"><span class="name">${esc(a.label)}</span></div>
  <div class="cwd">${esc(a.workspace)}</div>
  <button class="org-edit" data-org="${esc(a.id)}"
    title="Change who ${esc(a.label)} works with"
    aria-label="Change who ${esc(a.label)} works with">⋯</button>
</div>`;

/** The legend: what each colour of arrow means. Without it the colours are just decoration. */
const legend = () => `<div class="org-legend">${kindList().map((k) => `
  <span class="leg k-${esc(k.key)}"><i></i>${esc(k.label)} — ${esc(k.arrow ?? '')}</span>`).join('')}</div>`;

export function paintOrg() {
  const sheet = document.querySelector('.org');
  if (!sheet) return;
  const all = agentsOf(theModel());
  const byId = new Map(all.map((a) => [a.id, a]));
  const { tiers, loose } = tiersOf(wires(), all.map((a) => a.id));

  const rows = tiers.map((ids, i) => `<div class="org-row">
      <p class="org-rank">${esc(rowName(i, tiers.length))}</p>
      <div class="org-cards">${ids.map((id) => agentCard(byId.get(id))).join('')}</div>
    </div>`).join('');

  const rest = loose.length ? `<div class="org-row loose">
      <p class="org-rank">Not connected${tiers.length ? '' : ' yet'}</p>
      <div class="org-cards">${loose.map((id) => agentCard(byId.get(id))).join('')}</div>
    </div>` : '';

  sheet.querySelector('.org-chart').innerHTML = rows + rest
    || '<p class="muted-note">No agents are running.</p>';
  sheet.querySelector('.org-note').textContent = tiers.length
    ? `${wires().length} connection${wires().length === 1 ? '' : 's'} · every one can be changed or removed.`
    : 'Nothing is connected yet. Pick a ready-made shape above, or connect two agents on the map.';
  drawLinks();
}

/** Change who one agent works with: pick the other agent, then pick what the line means. */
function editAgent(id, at) {
  const all = agentsOf(theModel());
  const me = all.find((a) => a.id === id);
  if (!me) return;
  const mine = wires().filter((w) => w.from === id || w.to === id);
  menuAt(at, `Who does ${me.label} work with?`, [
    { head: me.label },
    ...all.filter((a) => a.id !== id).map((a) => ({ key: `to:${a.id}`, label: `Connect to ${a.label}` })),
    mine.length ? { head: 'Or' } : null,
    mine.length ? { key: 'off', label: 'Disconnect it from everything', cls: 'drop' } : null,
  ], (key) => {
    if (key === 'off') {
      // Highest index first, so removing one does not shift the next one out from under us.
      for (const w of mine.sort((a, b) => b.i - a.i)) removeWire(w.i);
      return paintOrg();
    }
    const other = key.slice(3);
    menuAt(at, `How do ${me.label} and ${all.find((a) => a.id === other).label} work together?`,
      kindList().map((k) => ({ key: k.key, label: k.label, blurb: k.blurb })),
      (kind) => { addWire(id, other, kind); paintOrg(); });
  });
}

export async function openOrg() {
  document.querySelector('.org-overlay')?.remove();
  if (!presets.length) {
    const r = await get('/api/org/presets');
    presets = r.ok ? r.presets : [];
  }

  const ov = document.createElement('div');
  ov.className = 'overlay org-overlay';
  ov.innerHTML = `<div class="sheet org">
    <div class="sheet-head">
      <h3 class="display">Who leads whom</h3>
      <div class="actions">
        <span class="flow-msg org-msg" role="status" aria-live="polite"></span>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="muted-note">Your agents, arranged by who is above whom. Start from a ready-made
      shape, then change any single connection — nothing here is guessed.</p>
    <div class="org-presets">${presets.map((p) => `
      <button class="chip" data-preset="${esc(p.id)}" title="${esc(p.why)}">
        ${esc(p.name)}<small>${esc(p.why)}</small></button>`).join('')}</div>
    ${legend()}
    <div class="org-chart"></div>
    <p class="muted-note org-note"></p>
  </div>`;
  // Built in the floating layer like every other panel; the router lifts it into the page.
  document.body.appendChild(ov);
  paintOrg();

  ov.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return closeOrg();

    const edit = e.target.closest('[data-org]');
    if (edit) {
      e.preventDefault();
      e.stopPropagation();
      const r = edit.getBoundingClientRect();
      return editAgent(edit.dataset.org, { x: r.left, y: r.bottom + 6 });
    }

    const preset = e.target.closest('[data-preset]')?.dataset.preset;
    if (!preset) return;
    // Applying replaces every line, so it is the one action here that can throw work away.
    if (wires().length && !confirmOnce('Replace every connection with this shape? The agents themselves are not touched.')) return;
    const out = await post('/api/org/preset', { id: preset });
    if (!out.ok) return headMsg(out.error);
    setWires(out.wires);
    paintOrg();
    ov.querySelector('.org-msg').textContent =
      out.wires.length ? `Applied across ${out.agents} agents.` : 'Connections cleared.';
  });
}
