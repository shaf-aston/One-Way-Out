// The keyboard: every key this app answers to, and who does the thing.
//
// The page that EXPLAINS these keys is guide.js. It reads the same KEYS list, so a new key
// and the line describing it are still one edit — the list simply lives here and is drawn
// there, beside the pictures.
//
// One list. Every key this app answers to is a row in KEYS, sitting next to the words that
// describe it, and the help panel is drawn FROM that list rather than from a second copy typed
// out by hand. A typed-out copy is a lie the moment somebody adds a key; this way adding a key
// and writing down what it does are the same edit.
//
// A row with an `id` is pressed here: the module that can actually do the thing claims it with
// `bindKey`, so no panel has to be imported into this file. A row without an `id` is a key the
// browser already gives us on whatever is focused (Enter and Space press a button), or a rule
// that belongs with the thing it closes — listed so the help is complete, handled where the
// element lives.

// The letters that reach a page work whenever no panel or dialog is open. While one is, the
// letters belong to it — otherwise pressing I over a half-filled form would throw it away. The
// agent viewer is deliberately not counted: it is a look, not a place.
const free = () => !document.querySelector('.overlay:not(.agent-overlay)');
const reading = () => !!document.querySelector('.agent-overlay');
const page = (key, id, name, does) => ({ id, key, where: 'Anywhere, when no panel is open', when: free, does: `Go to ${name}: ${does}` });

/**
 * Every key, in the order the help reads them. `where` answers "when does this work?" and
 * `does` says what physically happens, in the second person — these words go on screen exactly
 * as they are, so they are written for the person pressing the key, not for a developer.
 */
export const KEYS = [
  { id:'help', key:'?', where:'Anywhere',
    does:'Open this help. Press ? again, or Escape, to put it away.' },
  page('D', 'go-dashboard', 'the Dashboard', 'what needs you, and how the company is doing.'),
  page('I', 'go-issues', 'Issues', 'every piece of work, as a board you can drag between columns.'),
  page('G', 'go-goals', 'Goals', 'what the company is aiming at, and how far each goal has got.'),
  page('O', 'go-org', 'the Org chart', 'who works here, who reports to whom, and their budgets.'),
  page('R', 'go-routines', 'Routines', 'work that repeats on a schedule.'),
  page('B', 'go-inbox', 'the Inbox', 'plans, hires and budgets waiting for your yes or no.'),
  page('L', 'go-activity', 'the Activity log', 'everything that happened, and who did it.'),
  page('A', 'go-agents', 'Agents', 'the live map of every agent running in Herdr.'),
  { id:'new-issue', key:'C', where:'Anywhere, when no panel is open', when:free,
    does:'Create an issue — a title is enough; assign it and it starts at the next heartbeat.' },
  { id:'new-agent', key:'N', where:'Anywhere, when no panel is open', when:free,
    does:'Start a plain agent in a folder, outside any company.' },
  { id:'move', key:'M', where:'On an agent card, once you have moved to it with Tab',
    does:'Move that agent into another Herdr window or page. It keeps its whole conversation.' },
  { id:'full', key:'F', where:'While you are reading an agent', when:reading,
    does:'Give that agent the whole window. Press F again to shrink it back.' },
  { key:'Enter or Space', where:'On an agent card, or an employee who is running',
    does:'Open that agent and read what it is doing right now.' },
  { key:'Enter', where:'In the box where you write back to an agent',
    does:'Send what you typed to that agent. Hold Shift and press Enter to start a new line instead.' },
  { key:'up and down arrows', where:'In that same box, cursor at the very start or the very end',
    does:'Bring back something you sent this agent earlier, so you can send it again.' },
  { key:'/', where:'In the box where you write back to an agent',
    does:'List the commands and skills this machine already has. Arrows pick one, Tab or Enter puts it in.' },
  { key:'Escape', where:'Anywhere',
    does:'Close whatever is on top — a dialog, a panel, or a small menu.' },
];

/**
 * Claim a key. The list owns which key it is and how it reads; the module that can do the
 * thing owns what happens.
 * @param {string} id - the `id` of a row in KEYS
 * @param {(e: KeyboardEvent) => void} run
 */
export function bindKey(id, run) {
  const row = KEYS.find((k) => k.id === id);
  if (row) row.run = run;
}

// A key press is for the page, never for the sentence somebody is in the middle of writing.
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
  || !!document.activeElement?.isContentEditable;

/** Start listening. Called once by the page, after every module has claimed its keys. */
export function startKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing()) return;
    const row = KEYS.find((k) => k.run && k.key.toLowerCase() === e.key.toLowerCase()
      && (!k.when || k.when()));
    if (!row) return;
    e.preventDefault();
    row.run(e);
  });
}
