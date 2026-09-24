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

// The four letters that reach a view are the map's own. While a panel or a dialog is open the
// letters belong to it — otherwise pressing W over a half-filled New agent form would throw it
// away. The agent viewer is deliberately not counted: it is a look, not a place.
const onMap = () => !document.querySelector('.overlay:not(.agent-overlay)');
const reading = () => !!document.querySelector('.agent-overlay');

/**
 * Every key, in the order the help reads them. `where` answers "when does this work?" and
 * `does` says what physically happens, in the second person — these words go on screen exactly
 * as they are, so they are written for the person pressing the key, not for a developer.
 */
export const KEYS = [
  { id:'help', key:'?', where:'Anywhere',
    does:'Open this help. Press ? again, or Escape, to put it away.' },
  { id:'new-agent', key:'N', where:'On the map', when:onMap,
    does:'Start a new agent — you pick the folder it works in and give it a name.' },
  { id:'hierarchy', key:'O', where:'On the map', when:onMap,
    does:'Show the same agents stacked by who leads whom.' },
  { id:'workflows', key:'W', where:'On the map', when:onMap,
    does:'Open Workflows: one agent does a job, and when it finishes the next one starts.' },
  { id:'run', key:'R', where:'On the map', when:onMap,
    does:'Open New run: type one goal and a team of agents is built to do it.' },
  { id:'move', key:'M', where:'On an agent card, once you have moved to it with Tab',
    does:'Move that agent into another Herdr window or page. It keeps its whole conversation.' },
  { id:'full', key:'F', where:'While you are reading an agent', when:reading,
    does:'Give that agent the whole window. Press F again to shrink it back.' },
  { key:'Enter or Space', where:'On an agent card',
    does:'Open that agent and read what it is doing right now.' },
  { key:'Enter or Space', where:'On the small dot at the edge of a card',
    does:'Start a line from that agent. Move to another card and press Enter to join the two.' },
  { key:'Enter or Space', where:'On a line already drawn between two agents',
    does:'Say what that connection means, or take the line away.' },
  { key:'Enter', where:'In the box where you write back to an agent',
    does:'Send what you typed to that agent. Hold Shift and press Enter to start a new line instead.' },
  { key:'up and down arrows', where:'In that same box, cursor at the very start or the very end',
    does:'Bring back something you sent this agent earlier, so you can send it again.' },
  { key:'/', where:'In the box where you write back to an agent, and in a workflow step',
    does:'List the commands and skills this machine already has. Arrows pick one, Tab or Enter puts it in.' },
  { key:'Escape', where:'Anywhere',
    does:'Close whatever is on top — a panel, a small menu, or a line you had started drawing.' },
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
