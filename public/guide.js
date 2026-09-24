// The guide: what this page is, and how to use it, in pictures.
//
// Four tabs rather than one long page, because a person opens this to answer ONE question —
// what am I looking at, how do I join two agents, what does that key do, what is that tab —
// and reading past three answers to reach the fourth is the thing that makes help unread.
//
// The pictures are real screenshots of this app, taken from a copy of it, and they live in
// public/guide/. The words beside them are here; the KEYS table and the four connection
// meanings are NOT — those are generated from the same lists the app itself runs on, so a
// new key or a new kind of connection turns up in the guide without anybody remembering to
// write it down twice.
import { esc, onOverlayEscape } from './ui.js';
import { KEYS } from './keys.js';
import { kindList, loadKinds } from './wires.js';

const START = [
  ['Every box is one agent',
    'A box is one AI agent running in Herdr. Its colour says what it is doing: green means it has finished and is waiting for you, gold means it is busy, grey means it is idle. The line along the top counts them.'],
  ['Look at the green ones first',
    'They are the only ones wanting anything from you. Everything else is either working or sitting still.'],
  ['Click a box to read it',
    'You get that agent\'s screen exactly as it looks in the terminal, and a box at the bottom to write back in. Press Enter to send.'],
  ['Starting a new one',
    'Press "New agent", pick the folder it should work in, give it a short name. It opens in Herdr and turns up here within a couple of seconds.'],
];

/* The four steps of drawing a connection, each one a real photograph of the step. */
const STEPS = [
  ['2-dot', 'Point at any agent. A small dot appears on its edge.',
    'The dot on the edge of an agent card'],
  ['3-drag', 'Press on that dot and drag onto another agent.',
    'A dashed line being dragged from one card down to another'],
  ['4-kind-menu', 'Let go, and it asks what the two are to each other.',
    'The menu of four connection meanings, opened where the line was dropped'],
  ['5-arrow', 'A labelled arrow stays between them, saying what they are to each other.',
    'A finished arrow between two agent cards, labelled with what the connection means'],
];

const ALSO = [
  'Once any line exists, a box appears above the map: type one job there and every connected group gets it, each agent told its own part of it.',
  'Click the arrow\'s label to change what it means, or to take the line away.',
  'Without a mouse: Tab to the dot, press Enter, Tab to the other agent, press Enter again.',
  'Hierarchy reads these lines and nothing else — it never guesses at a chain of command.',
];

const VIEWS = [
  ['Sessions', 'The map. Every agent, grouped by the Herdr window it sits in. This is home.'],
  ['Hierarchy', 'The same agents, stacked by who leads whom, read from the lines you drew.'],
  ['Workflows', 'A relay you save and run again: this agent does this, and when it goes quiet the next one starts.'],
  ['New run', 'Type one goal. A planner reads the folder and writes out the jobs, you edit that list, then one agent is started for each job.'],
];

const rows = (list) => list.map(([h, p]) => `<div class="g-row"><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`).join('');

const figure = (name, caption, alt, n) => `<figure class="g-fig">
  <img src="guide/${name}.png" alt="${esc(alt)}" loading="lazy">
  <figcaption>${n ? `<b>${n}</b>` : ''}${esc(caption)}</figcaption>
</figure>`;

/** A short piece of the line itself, drawn the way the map draws it — same colour, same dashes. */
const lineSample = (k) => `<svg class="g-line" viewBox="0 0 56 10" aria-hidden="true">
  <path d="M1,5 H48" stroke="var(${esc(k.wire?.token ?? '--gold')})" stroke-width="2"
    ${k.wire?.dashed ? 'stroke-dasharray="6 5"' : ''} fill="none"/>
  <path d="M46,1 L54,5 L46,9 Z" fill="var(${esc(k.wire?.token ?? '--gold')})"/>
</svg>`;

/** What each connection MEANS — from the server's own list, never a second copy typed here. */
const kindTable = () => `<table class="g-kinds"><tbody>${kindList().map((k) => `<tr>
    <td>${lineSample(k)}</td>
    <td><b>${esc(k.label)}</b><br><small>${esc(k.arrow)}${k.back ? `, and ${esc(k.back)}` : ''}</small></td>
    <td>${esc(k.blurb)}</td>
  </tr>`).join('')}</tbody></table>`;

const keyTable = () => `<table class="keys"><tbody>${KEYS.map((k) => `<tr>
    <td><kbd>${esc(k.key)}</kbd></td><td>${esc(k.where)}</td><td>${esc(k.does)}</td>
  </tr>`).join('')}</tbody></table>`;

const TABS = [
  { id: 'start', label: 'Start here', body: () => `<div class="g-two">
      <div class="g-text">${rows(START)}</div>
      <div class="g-shots">
        ${figure('1-board', 'The map: every agent, sorted by whether it needs you.', 'The One-Way-Out board with three columns of agent cards')}
        ${figure('6-read', 'Clicking one opens its screen, with a box to write back in.', 'One agent open, its terminal screen shown with a reply box underneath')}
      </div>
    </div>` },
  { id: 'connect', label: 'Connecting agents', body: () => `
      <div class="g-steps">${STEPS.map(([n, cap, alt], i) => figure(n, cap, alt, i + 1)).join('')}</div>
      <h4>What the four choices mean</h4>
      ${kindTable()}
      <ul class="g-also">${ALSO.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` },
  { id: 'keys', label: 'Keys', body: keyTable },
  { id: 'views', label: 'The four pages', body: () => `<div class="g-text wide">${rows(VIEWS)}</div>` },
];

const close = () => { document.querySelector('.help-overlay')?.remove(); };
const toggle = () => (document.querySelector('.help-overlay') ? close() : open());

function show(ov, id) {
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  ov.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab.id;
    b.classList.toggle('on', on);                       // the same selected look the viewer's switch has
    b.setAttribute('aria-pressed', String(on));
  });
  const body = ov.querySelector('.help-body');
  body.innerHTML = tab.body();
  body.scrollTop = 0;
}

async function open() {
  await loadKinds();                       // the meanings come from the server, so wait for them
  const ov = document.createElement('div');
  ov.className = 'overlay help-overlay';
  ov.innerHTML = `<div class="sheet help">
    <div class="sheet-head">
      <h3 class="display">How this page works</h3>
      <div class="actions">
        <div class="seg" role="group" aria-label="Which part of the guide">
          ${TABS.map((t) => `<button data-tab="${t.id}" aria-pressed="false">${esc(t.label)}</button>`).join('')}
        </div>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <div class="help-body"></div>
  </div>`;
  document.body.appendChild(ov);
  show(ov, TABS[0].id);
  ov.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) return show(ov, tab.dataset.tab);
    if (e.target === ov || e.target.closest('[data-act="close"]')) close();
  });
  ov.querySelector('[data-act="close"]').focus();
}

/** Claim the ? key and every button anywhere that carries `data-help`. */
export function startGuide(bindKey) {
  bindKey('help', toggle);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-help]')) toggle(); });
  onOverlayEscape('.help-overlay', close);
}
