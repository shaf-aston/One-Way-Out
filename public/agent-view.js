// The agent viewer: one agent's live screen, read and answered without leaving the map.
//
// It is a look on top of wherever you are, never a place of its own — so it owns no URL and
// leaves no history entry. Everything it shows comes from the agent itself (reader.js turns
// the terminal's own colours into HTML); nothing here invents text.
import { $, esc, get, post, autoGrow, attachPalette, clean, confirmOnce } from './ui.js';
import { parseAnsi, toLog, toTerminal, chooseKeys } from './reader.js';
import { isWiring, finishFromKeyboard } from './connect.js';
import { go } from './router.js';

// How often the open screen re-reads, handed in so this module does not fetch config itself.
let pollMs = 1500;
export const setPollMs = (ms) => { pollMs = ms; };

/* ── Agent detail: watch the live screen, reply, jump to it in Herdr ── */
let openPane = null, screenTimer = null, rawText = '';
const history = [];   // what you have sent this session, newest last
let historyAt = 0;

/* The agent's terminal is ~90 columns; the screen is 1600px. Rather than leave half the
   panel empty, the panel takes the width THIS agent's text actually needs. Rounded to 40px
   and only re-applied on a big change, so the 1.5s refresh can never make it twitch. */
function fitSheet(el, text) {
  const sheet = el.closest('.sheet');
  // The 90th-percentile line, not the longest: one stray 300-char path should not
  // stretch the panel across the screen for the other 500 lines.
  const lens = text.split('\n').map((l) => l.length).filter(Boolean).sort((a, b) => a - b);
  if (!lens.length) return;
  const cols = Math.min(160, Math.max(72, lens[Math.floor(lens.length * 0.9)]));
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  probe.style.font = getComputedStyle(el).font;
  probe.textContent = '0'.repeat(20);
  el.appendChild(probe);
  const chW = probe.getBoundingClientRect().width / 20;
  probe.remove();
  const want = Math.ceil((cols * chW + 90) / 40) * 40;
  const now = parseInt(sheet.style.getPropertyValue('--sheet-w'), 10) || 0;
  if (Math.abs(want - now) > 80) sheet.style.setProperty('--sheet-w', `${Math.max(860, want)}px`);
}

/* Which view the agent screen opens in. Remembered on this machine, so the choice is made
   once; falls back to the reader when storage is unavailable. */
const VIEW_KEY = 'herdr-map.screen-view';
const getView = () => { try { return localStorage.getItem(VIEW_KEY) || 'reader'; } catch { return 'reader'; } };
const setView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

// Whether tool calls show in the block log — remembered the same way as the view itself.
const TOOLS_KEY = 'herdr-map.screen-tools';
const getTools = () => { try { return localStorage.getItem(TOOLS_KEY) !== 'off'; } catch { return true; } };
const setTools = (on) => { try { localStorage.setItem(TOOLS_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

function paintScreen() {
  const el = document.querySelector('.screen');
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const text = clean(rawText);
  const lines = parseAnsi(text);
  const reader = getView() === 'reader';
  el.classList.toggle('reader', reader);
  el.classList.toggle('hide-tools', reader && !getTools());
  // The live repaint every 1.5s must not slam shut a tool group you just opened.
  const wasOpen = [...el.querySelectorAll('.tool-run')].map((d) => d.open);
  el.innerHTML = reader ? toLog(lines) : toTerminal(lines);
  el.querySelectorAll('.tool-run').forEach((d, i) => { if (wasOpen[i]) d.open = true; });

  // One chip per message you sent — click to jump back to that exchange.
  const turnsBar = document.querySelector('.turns');
  if (turnsBar) {
    turnsBar.innerHTML = !reader ? '' : [...el.querySelectorAll('.blk.you')].slice(-12).map((b) =>
      `<button data-jump="${b.dataset.turn}" title="Jump to this message">${esc(b.textContent.trim().slice(0, 40))}</button>`).join('');
  }
  // The block log takes the whole panel width on purpose; the terminal is sized instead
  // to however many columns this particular agent is drawing.
  if (reader) el.closest('.sheet')?.style.setProperty('--sheet-w', 'min(1300px,96vw)');
  else fitSheet(el, lines.map((l) => l.map((r) => r.t).join('')).join('\n'));
  if (atBottom) el.scrollTop = el.scrollHeight;

  // Hiding tool calls must say how many it hid — otherwise a quiet agent and a filtered
  // one look identical.
  const toolsBtn = document.querySelector('[data-act="tools"]');
  if (toolsBtn && reader && !getTools()) {
    const n = el.querySelectorAll('.blk.tool').length;
    toolsBtn.textContent = n ? `Tools: ${n} hidden` : 'Tools: hidden';
  }
}

/* One failed poll must not blank the transcript you are reading — keep the last good text
   and put the problem in a banner above it. */
async function refreshScreen() {
  if (!openPane) return;
  const r = await get(`/api/pane/read?id=${encodeURIComponent(openPane)}&format=ansi`);
  const banner = document.querySelector('.read-error');
  if (!document.querySelector('.screen')) return;
  if (r.ok) {
    rawText = r.text || '(screen is empty)';
    if (banner) banner.hidden = true;
  } else if (banner) {
    banner.hidden = false;
    banner.textContent = `Not reading this agent right now — ${r.error} Still trying.`;
  }
  paintScreen();
}

/** Closing throws away whatever you were typing, so ask when there is something to lose. */
export function closeSheet(force = false) {
  const box = document.querySelector('.agent-overlay textarea');
  if (!force && box?.value.trim() && !confirmOnce('Throw away the reply you were typing?')) return false;
  openPane = null;
  clearInterval(screenTimer);
  document.querySelector('.agent-overlay')?.remove();
  return true;
}

/** Light up whichever view is active, so the switch always shows where you are. */
const markView = (ov) => {
  ov.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === getView()));
  const toolsBtn = ov.querySelector('[data-act="tools"]');
  if (toolsBtn) {
    toolsBtn.hidden = getView() !== 'reader';
    toolsBtn.classList.toggle('on', getTools());
    toolsBtn.textContent = getTools() ? 'Tools: shown' : 'Tools: hidden';
  }
};

export function openSheet(paneId, label, cwd) {
  closeSheet(true);
  openPane = paneId;
  rawText = 'Reading…';
  historyAt = history.length;

  const ov = document.createElement('div');
  ov.className = 'overlay agent-overlay';
  ov.innerHTML = `<div class="sheet">
    <div class="sheet-head">
      <h3 class="display">${esc(label)}</h3>
      <div class="actions">
        <div class="seg" role="group" aria-label="How to show this agent">
          <button data-view="reader" title="One block per turn, sized for reading">Reader</button>
          <button data-view="terminal" title="The screen exactly as the terminal draws it">Terminal</button>
        </div>
        <button class="btn" data-act="tools" title="Show or hide the tool-call blocks — replies always stay">Tools</button>
        <button class="btn" data-act="focus">Open in Herdr</button>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <div class="teams-strip in-sheet" id="sheet-teams" aria-label="Saved connections"></div>
    <p class="read-error" role="status" aria-live="polite" hidden></p>
    <div class="turns" aria-label="Jump to a message you sent"></div>
    <div class="screen"></div>
    <div class="composer">
      <textarea rows="1" maxlength="4000" placeholder="Reply to this agent — Enter sends, “/” lists commands, ↑ brings back what you sent"></textarea>
      <button class="btn primary" data-act="send">Send</button>
      <button class="btn" data-act="enter" title="Just press Enter — accepts the highlighted option">↵ Enter</button>
      <button class="btn" data-act="key-up" title="Move up the agent's menu">↑</button>
      <button class="btn" data-act="key-down" title="Move down the agent's menu">↓</button>
      <button class="btn" data-act="key-escape" title="Press Esc in the agent — stops what it is doing">Esc</button>
      <button class="btn" data-act="key-mode" title="Press Shift+Tab in the agent — switches its working mode">Mode ⇧⇥</button>
    </div>
    <div class="hintline">This is the agent's own screen, live. Claude's slash commands work here — type “/model sonnet” and send. “↵ Enter” accepts a highlighted menu choice.</div>
  </div>`;
  document.body.appendChild(ov);

  ov.querySelector('#sheet-teams').innerHTML = $('teams-strip').innerHTML;
  const box = ov.querySelector('textarea');
  const palette = attachPalette(box, () => cwd || null);

  /** Send a run of keys to this agent; a failure is a banner, never a lost transcript. */
  const pressKeys = async (keys, ov) => {
    const r = await post('/api/pane/keys', { id: paneId, keys });
    const banner = ov.querySelector('.read-error');
    if (!r.ok && banner) { banner.hidden = false; banner.textContent = `That did not land — ${r.error}`; }
    setTimeout(refreshScreen, 400);
  };

  const sendText = async (text) => {
    if (text.trim()) { history.push(text); historyAt = history.length; }
    box.value = '';
    autoGrow(box);
    const r = await post('/api/pane/send', { id: paneId, text });
    // A failed send is a banner, same as a failed read — never overwrite the transcript
    // you were reading with the error, or the agent's own words disappear underneath it.
    const banner = ov.querySelector('.read-error');
    if (!r.ok && banner) { banner.hidden = false; banner.textContent = `That reply did not send — ${r.error}`; }
    setTimeout(refreshScreen, 350);
  };

  ov.addEventListener('click', (e) => {
    if (e.target === ov) return closeSheet();
    const chip = e.target.closest('[data-team-chip]');
    if (chip) { if (closeSheet()) go('teams', chip.dataset.teamChip || null); return; }
    const view = e.target.closest('[data-view]')?.dataset.view;
    if (view) { setView(view); markView(ov); paintScreen(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeSheet();
    if (act === 'send') sendText(box.value);
    if (act === 'enter') sendText('');
    if (act === 'tools') { setTools(!getTools()); markView(ov); paintScreen(); }
    if (act === 'focus') post('/api/pane/focus', { id: paneId });
    const KEYS = { 'key-escape': ['escape'], 'key-mode': ['shift+tab'], 'key-up': ['up'], 'key-down': ['down'] };
    // Picking option N walks the menu with its own arrow keys, then presses Enter.
    const opt = e.target.closest('[data-choice]');
    const keys = KEYS[act] || (opt && chooseKeys(+opt.dataset.choice, +opt.dataset.choiceOf));
    if (keys) pressKeys(keys, ov);
    const jump = e.target.closest('[data-jump]');
    if (jump) ov.querySelector(`.blk.you[data-turn="${jump.dataset.jump}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  // A menu option is a button, so Enter and Space pick it the same as a click.
  ov.addEventListener('keydown', (e) => {
    const opt = e.target.closest('[data-choice]');
    if (!opt || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    pressKeys(chooseKeys(+opt.dataset.choice, +opt.dataset.choiceOf), ov);
  });

  box.addEventListener('input', () => autoGrow(box));
  box.addEventListener('keydown', (e) => {
    if (palette.isOpen()) return;              // the palette owns the arrows while it is open
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return sendText(box.value); }
    if (e.key === 'ArrowUp' && box.selectionStart === 0 && historyAt > 0) {
      e.preventDefault();
      box.value = history[--historyAt];
      autoGrow(box);
    } else if (e.key === 'ArrowDown' && box.selectionStart === box.value.length && historyAt < history.length - 1) {
      e.preventDefault();
      box.value = history[++historyAt];
      autoGrow(box);
    }
  });

  markView(ov);
  paintScreen();
  refreshScreen();
  screenTimer = setInterval(refreshScreen, pollMs);
  box.focus();
}

// One opener for mouse and keyboard — a card is a button, so Enter and Space work too.
// A card click means one of two things and never both: while a line is being drawn the click
// finishes the line; otherwise it opens the agent.
function openFromCard(e) {
  if (isWiring() || e.target.closest('[data-port]')) return;
  const el = e.target.closest('[data-pane]');
  if (el && !e.target.closest('.overlay')) openSheet(el.dataset.pane, el.dataset.label, el.dataset.cwd);
}

/** Start listening for card clicks. Called once by main.js, after the page exists. */
export function watchCards() {
  document.addEventListener('click', openFromCard);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-pane]')) {
      e.preventDefault();
      if (isWiring()) return finishFromKeyboard(e.target.dataset.pane);
      openFromCard(e);
    }
  });
}
