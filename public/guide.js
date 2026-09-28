// The guide: what this app is, and how to use it.
//
// Four tabs rather than one long page, because a person opens this to answer ONE question —
// what is a company here, how does work move, what does that key do, what is that page — and
// reading past three answers to reach the fourth is the thing that makes help unread.
//
// The key table is NOT written here: it is generated from the same KEYS list the app runs on,
// so a new key turns up in the guide without anybody remembering to write it down twice.
import { esc, onOverlayEscape } from './ui.js';
import { KEYS } from './keys.js';

const START = [
  ['A company is a team of agents',
    'It has a mission, goals under the mission, and employees — AI agents running in Herdr, each with a title, a job, someone they report to, and a budget.'],
  ['You are the board',
    'You set goals, approve plans and hires, and accept finished work. Nothing is sent to any agent until you press Run company.'],
  ['Work is issues',
    'Every piece of work is an issue with one assignee. Assign it and, while the company runs, that employee picks it up at their next heartbeat.'],
  ['The fastest start',
    'Add a goal, press Plan it, approve the plan in the Inbox, press Run company. The CEO splits the goal; the team does the parts.'],
];

const FLOW = [
  ['Heartbeat',
    'Every few seconds the company looks at everyone. A free, active employee with a ready issue checks it out and is briefed: who they are, the mission, the goal, the issue, and where to write their result.'],
  ['One issue at a time',
    'An employee holds at most one issue in progress, and an issue that waits on others only starts once they are done. That is what stops two agents writing over each other.'],
  ['Done means a result file',
    'An issue is finished when its agent writes its result — never on a guess. An agent that goes quiet without one is reminded once, then the issue is blocked and its manager gets an issue to unblock it.'],
  ['Delegation',
    'A manager (anyone with reports) can hand work out by writing a small plan file. With "approve plans" on, it waits in your Inbox; approved, its issues appear under the manager\'s, and the manager checks them when they are all done.'],
  ['Budgets',
    'Each employee can have caps: issues a day, minutes of work a day, tokens a month. Hitting one pauses them and asks you in the Inbox whether to raise it.'],
  ['Routines',
    'A routine creates the same issue on a schedule — every N minutes, daily, or weekdays at a time.'],
  ['Activity',
    'Every change — yours, an agent\'s, or the heartbeat\'s — is written to the Activity log and never rewritten.'],
];

const VIEWS = [
  ['Dashboard', 'What needs you first — approvals, work to review, blocked issues, agents asking a question — then the team and what they are doing.'],
  ['Issues', 'The board. Drag a card between columns; drop one on In progress to hand it over now. Quick-add a title and press Enter.'],
  ['Goals', 'The mission and the goals under it, each with its progress and a Plan it button.'],
  ['Org', 'Who reports to whom. Hire, edit, pause, wake or let go — or hire an agent already running in Herdr.'],
  ['Routines', 'Work that repeats on a schedule.'],
  ['Inbox', 'Plans, hires and budgets waiting for your yes or no.'],
  ['Activity', 'Everything that happened, filterable by who and what.'],
  ['Agents', 'The live map of every agent in Herdr. Click one to read its screen and write back.'],
  ['Settings', 'The company\'s name, mission and approval rules, export and import, and Herdr\'s own look.'],
];

const rows = (list) => list.map(([h, p]) => `<div class="g-row"><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`).join('');

const figure = (name, caption, alt) => `<figure class="g-fig">
  <img src="guide/${name}.png" alt="${esc(alt)}" loading="lazy">
  <figcaption>${esc(caption)}</figcaption>
</figure>`;

const keyTable = () => `<table class="keys"><tbody>${KEYS.map((k) => `<tr>
    <td><kbd>${esc(k.key)}</kbd></td><td>${esc(k.where)}</td><td>${esc(k.does)}</td>
  </tr>`).join('')}</tbody></table>`;

const TABS = [
  { id: 'start', label: 'Start here', body: () => `<div class="g-two">
      <div class="g-text">${rows(START)}</div>
      <div class="g-shots">
        ${figure('6-read', 'Clicking a running employee, or any agent on the Agents page, opens its screen with a box to write back in.', 'One agent open, its terminal screen shown with a reply box underneath')}
      </div>
    </div>` },
  { id: 'flow', label: 'How work moves', body: () => `<div class="g-text wide">${rows(FLOW)}</div>` },
  { id: 'keys', label: 'Keys', body: keyTable },
  { id: 'views', label: 'The pages', body: () => `<div class="g-text wide">${rows(VIEWS)}</div>` },
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

function open() {
  const ov = document.createElement('div');
  ov.className = 'overlay help-overlay';
  ov.innerHTML = `<div class="sheet help">
    <div class="sheet-head">
      <h3 class="display">How One-Way-Out works</h3>
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
