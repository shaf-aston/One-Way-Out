// The agent viewer: one agent's live screen, read and answered without leaving the map.
//
// It is a look on top of wherever you are, never a place of its own — so it owns no URL and
// leaves no history entry. Everything it shows comes from the agent itself (reader.js turns
// the terminal's own colours into HTML); nothing here invents text.
import { $, esc, get, post, autoGrow, attachPalette, clean, confirmOnce } from './ui.js';
import { parseAnsi, toLog, toTerminal, readMode, MODES } from './reader.js';
import { isWiring, finishFromKeyboard } from './connect.js';
import { bindKey } from './keys.js';
import { go } from './router.js';

// How often the open screen re-reads, handed in so this module does not fetch config itself.
let pollMs = 1500;
export const setPollMs = (ms) => { pollMs = ms; };

/* ── Agent detail: watch the live screen, reply, jump to it in Herdr ── */
let openPane = null, screenTimer = null, rawText = '';
const history = [];   // what you have sent this session, newest last
let historyAt = 0;

/* Focused mode: the viewer takes the whole window instead of floating on the map. Remembered
   on this machine, so once you prefer it you get it every time you open an agent. */
const FULL_KEY = 'one-way-out.screen-full';
const getFull = () => { try { return localStorage.getItem(FULL_KEY) === 'on'; } catch { return false; } };
const setFull = (on) => { try { localStorage.setItem(FULL_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

/* The agent's terminal is ~90 columns; the screen is 1600px. Rather than leave half the
   panel empty, the panel takes the width THIS agent's text actually needs. Rounded to 40px
   and only re-applied on a big change, so the 1.5s refresh can never make it twitch. */
function fitSheet(el, text) {
  const sheet = el.closest('.sheet');
  if (sheet.closest('.full')) return;    // focused mode already owns the width
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
const VIEW_KEY = 'one-way-out.screen-view';
const getView = () => { try { return localStorage.getItem(VIEW_KEY) || 'reader'; } catch { return 'reader'; } };
const setView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

// Whether tool calls show in the block log — remembered the same way as the view itself.
/* Text size for the agent's own words. Browser zoom scales the whole page including the
   buttons; this scales only the transcript, and is remembered on this machine. */
const SIZES = [
  { key: 'normal', label: 'Text: normal', em: 1 },
  { key: 'big', label: 'Text: bigger', em: 1.18 },
  { key: 'biggest', label: 'Text: biggest', em: 1.38 },
];
const SIZE_KEY = 'one-way-out.screen-size';
const getSize = () => {
  try { return SIZES.find((s) => s.key === localStorage.getItem(SIZE_KEY)) ?? SIZES[0]; }
  catch { return SIZES[0]; }
};
const setSize = (key) => { try { localStorage.setItem(SIZE_KEY, key); } catch { /* private mode */ } };
const nextSize = () => SIZES[(SIZES.indexOf(getSize()) + 1) % SIZES.length];

const TOOLS_KEY = 'one-way-out.screen-tools';
const getTools = () => { try { return localStorage.getItem(TOOLS_KEY) !== 'off'; } catch { return true; } };
const setTools = (on) => { try { localStorage.setItem(TOOLS_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };
// Smart folding also tucks the ● call lines away (reader.js findCalls); basic folds only their results.
const FOLD_KEY = 'one-way-out.screen-fold';
const getSmart = () => { try { return localStorage.getItem(FOLD_KEY) !== 'basic'; } catch { return true; } };
const setSmart = (on) => { try { localStorage.setItem(FOLD_KEY, on ? 'smart' : 'basic'); } catch { /* private mode */ } };

/* ── The mode pill: what the agent does about permission, and how to change it ──
   It reports before it acts. "Accepting all plans" is the mode where the agent stops asking,
   and one click aims for it — but every press is checked against the agent's own screen, so
   a press that did not land can never be mistaken for one that did. */
let switching = false;

function paintMode() {
  const pill = document.querySelector('.mode-pill');
  if (!pill) return;
  const now = readMode(clean(rawText));
  pill.dataset.mode = now ?? 'unknown';
  pill.disabled = switching;
  if (switching) { pill.textContent = 'Switching…'; return; }
  if (!now) {
    // Fail loud: the words on the screen changed, so say so, and offer the one honest
    // action left — a single press, then look again.
    pill.textContent = 'Mode unknown · press Shift+Tab once';
    pill.title = "This agent's screen does not say which mode it is in. Clicking presses Shift+Tab once and looks again.";
    return;
  }
  pill.textContent = now === 'auto'
    ? `${MODES.auto.label} · back to asking`
    : `${MODES[now].label} · accept all plans`;
  pill.title = now === 'auto'
    ? 'This agent is not asking before each step. Click to make it ask again.'
    : 'Click to stop this agent asking before each step.';
}

// What the last paint was built from. A poll that brings back the same screen must not
// rebuild it: measured 2026-09-03, the transcript was torn down and redrawn every 1.5s
// whether or not a character had changed, which reads as the page flashing while you read.
let paintedSig = '';

/** Bring `el` to `html` touching only the top-level blocks that differ. A working agent's
 *  spinner changes every poll; before this the whole transcript was thrown away and rebuilt
 *  for it, so everything you were reading blinked once a second. Now only that block does. */
function morph(el, html) {
  const next = document.createElement('div');
  next.innerHTML = html;
  const olds = [...el.children], news = [...next.children];
  news.forEach((n, i) => {
    const o = olds[i];
    if (!o) el.appendChild(n);
    else if (o.outerHTML !== n.outerHTML) o.replaceWith(n);
  });
  for (const o of olds.slice(news.length)) o.remove();
}

function paintScreen() {
  paintMode();
  const el = document.querySelector('.screen');
  if (!el) return;
  const text = clean(rawText);
  const reader = getView() === 'reader';
  const sig = [text, reader, getTools(), getSmart(), getSize().em, !!el.closest('.full')].join('\u0000');
  if (sig === paintedSig && el.dataset.painted) return;
  paintedSig = sig; el.dataset.painted = '1';
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const lines = parseAnsi(text);
  el.classList.toggle('reader', reader);
  el.classList.toggle('hide-tools', reader && !getTools());
  // The live repaint every 1.5s must not slam shut a tool group you just opened.
  const wasOpen = [...el.querySelectorAll('.tool-run')].map((d) => d.open);
  el.style.setProperty('--text-em', getSize().em);
  morph(el, reader ? toLog(lines, { smart: getSmart() }) : toTerminal(lines));
  el.querySelectorAll('.tool-run').forEach((d, i) => { if (wasOpen[i]) d.open = true; });

  // One chip per message you sent — click to jump back to that exchange.
  const turnsBar = document.querySelector('.turns');
  if (turnsBar) {
    // Full page has room, so it keeps a longer trail of your own messages to jump back to.
    const keep = el.closest('.full') ? 40 : 12;
    morph(turnsBar, reader ? [...el.querySelectorAll('.blk.you')].slice(-keep).map((b) =>
      `<button data-jump="${b.dataset.turn}" title="Jump to this message">${esc(b.textContent.trim().slice(0, 40))}</button>`).join('') : '');
  }
  // The block log takes the whole panel width on purpose; the terminal is sized instead
  // to however many columns this particular agent is drawing.
  if (reader) el.closest('.sheet')?.style.setProperty('--sheet-w', 'min(1840px,97vw)');
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

/* Two different things were sharing one line above the transcript. A read that failed is a
   passing condition — the next poll a second later can honestly clear it. An action that did
   not happen is a fact about what you just did, and clearing it is your call, not a timer's.
   Measured 2026-09-01: a reply that never reached the agent looked identical to one that did
   about a second later, because the poll below wiped the banner out from under it. So a
   failed action has its own line now, and only the "Got it" button takes it away. */
/** It landed after all, so a notice saying it did not is no longer true and goes on its own.
 *  Keeping a failure until it is read is the rule; keeping one the app has since disproved
 *  would leave the screen arguing with itself. */
const sayWorked = () => {
  const el = document.querySelector('.act-error');
  if (el) el.hidden = true;
};

const sayFailed = (message) => {
  const el = document.querySelector('.act-error');
  if (!el) return;
  el.querySelector('.act-error-text').textContent = message;
  el.hidden = false;
};

/* One failed poll must not blank the transcript you are reading — keep the last good text
   and put the problem in a banner above it. This banner, and only this banner, is the poll's
   to clear. */
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
  const foldBtn = ov.querySelector('[data-act="fold"]');
  if (foldBtn) {
    foldBtn.hidden = getView() !== 'reader';
    foldBtn.classList.toggle('on', getSmart());
    foldBtn.textContent = getSmart() ? 'Folding: smart' : 'Folding: basic';
    foldBtn.setAttribute('aria-pressed', String(getSmart()));
  }
  const sizeBtn = ov.querySelector('[data-act="size"]');
  if (sizeBtn) {
    const now = getSize();
    ov.querySelector('.screen')?.style.setProperty('--text-em', now.em);
    sizeBtn.textContent = now.label;
    sizeBtn.classList.toggle('on', now.key !== 'normal');
    sizeBtn.title = `Make the agent's text ${nextSize().label.replace('Text: ', '')} (Ctrl and + zooms everything instead)`;
  }
  const fullBtn = ov.querySelector('[data-act="full"]');
  if (fullBtn) {
    const on = ov.classList.contains('full');
    fullBtn.classList.toggle('on', on);
    fullBtn.textContent = on ? 'Leave full page' : 'Full page';
    fullBtn.setAttribute('aria-pressed', String(on));
  }
};

export function openSheet(paneId, label, cwd) {
  closeSheet(true);
  openPane = paneId;
  rawText = 'Reading…';
  historyAt = history.length;

  const ov = document.createElement('div');
  ov.className = `overlay agent-overlay${getFull() ? ' full' : ''}`;
  ov.innerHTML = `<div class="sheet">
    <div class="sheet-head">
      <h3 class="display" title="${esc(label)}">${esc(label)}</h3>
      <div class="actions">
        <div class="seg" role="group" aria-label="How to show this agent">
          <button data-view="reader" title="One block per turn, sized for reading">Reader</button>
          <button data-view="terminal" title="The screen exactly as the terminal draws it">Terminal</button>
        </div>
        <button class="btn" data-act="tools" title="Show or hide the tool-call blocks — replies always stay">Tools</button>
        <button class="btn" data-act="fold" title="Smart: tool-call lines fold away with their results. Basic: only the results fold">Folding: smart</button>
        <button class="btn" data-act="size">Text: normal</button>
        <button class="btn" data-act="full" title="Give this agent the whole window (F)">Full page</button>
        <button class="btn" data-act="focus">Open in Herdr</button>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="read-error" role="status" aria-live="polite" hidden></p>
    <p class="act-error" role="alert" hidden>
      <span class="act-error-text"></span>
      <button class="btn" data-act="seen"
        title="Hide this line. It does not undo anything and it does not try again.">Got it</button>
    </p>
    <div class="turns" aria-label="Jump to a message you sent"></div>
    <div class="screen"></div>
    <div class="shots" aria-label="Pictures going with your next message"></div>
    <div class="composer">
      <textarea rows="1" maxlength="4000" placeholder="Reply — Enter sends · paste a picture to attach it · “/” lists commands · ↑ brings back what you sent"></textarea>
      <label class="btn file" title="Send a picture to this agent">Attach image<input type="file" accept="image/*" multiple hidden></label>
      <button class="btn primary" data-act="send">Send <small>↵</small></button>
    </div>
    <!-- Under the box, in order of how often it is true: what the agent is doing about
         permission, the keys you only need when a menu is not clickable, and — set apart,
         because it interrupts real work — stopping it. -->
    <div class="agent-bar">
      <button class="btn mode-pill" data-act="mode" aria-live="polite">Reading the agent's mode…</button>
      <details class="fallback-keys">
        <summary>Menu keys</summary>
        <div>
          <button class="btn" data-act="key-up">Move up <small>↑</small></button>
          <button class="btn" data-act="key-down">Move down <small>↓</small></button>
          <button class="btn" data-act="enter">Choose highlighted <small>↵</small></button>
        </div>
      </details>
      <button class="btn danger" data-act="key-escape"
        title="Interrupts whatever the agent is doing right now">Stop agent <small>Esc</small></button>
    </div>
    <div class="hintline">This is the agent's own screen, live. Claude's slash commands work here — type “/model sonnet” and send. “↵ Enter” accepts a highlighted menu choice.</div>
  </div>`;
  document.body.appendChild(ov);

  const box = ov.querySelector('textarea');
  const palette = attachPalette(box, () => cwd || null);

  /** Press something in this agent: a run of keys, or one menu option. A key that did not
   *  land says so and stays said — it never quietly disappears a second later, and it never
   *  costs you the transcript you were reading. */
  const pressKeys = async (what) => {
    const r = await post('/api/pane/keys', { id: paneId, ...what });
    if (!r.ok) sayFailed(`That key never reached the agent — ${r.error} Nothing was pressed, so it is still on the same screen.`);
    else sayWorked();
    setTimeout(refreshScreen, 400);
  };

  /** Aim for a mode: press, look, press again — never a guessed run of presses. */
  const goToMode = async (want) => {
    switching = true;
    paintMode();
    for (let i = 0; i < 4; i++) {
      await post('/api/pane/keys', { id: paneId, keys: ['shift+tab'] });
      await new Promise((r) => setTimeout(r, 450));
      await refreshScreen();
      if (readMode(clean(rawText)) === want) break;
      if (want === null) break;                 // unknown mode: exactly one press, then stop
    }
    switching = false;
    paintMode();
    if (want && readMode(clean(rawText)) !== want) {
      sayFailed('The mode did not change — this agent is still in the mode it was already in. Open it in Herdr and check it is sitting at a prompt.');
    }
  };

  /* Pictures waiting to go with the next message. An agent reads files, not clipboards, so
     each one is already saved and what we hold is its path — the thumbnail is only so you
     can see what you attached, and the × takes it back off. */
  let shots = [];                            // { path, src }

  const paintShots = () => {
    const strip = ov.querySelector('.shots');
    strip.innerHTML = shots.map((s, i) => `<span class="shot">
      <img src="${esc(s.src)}" alt="Picture to send">
      <button data-drop-shot="${i}" title="Do not send this one" aria-label="Remove this picture">×</button>
    </span>`).join('');
  };

  /** Keep a pasted or dropped picture, ready to send. */
  const attachImage = async (file) => {
    if (shots.length >= 6) return sayFailed('Six pictures is the most that go with one message, so that one was not attached.');
    const dataUrl = await new Promise((done) => {
      const fr = new FileReader();
      fr.onload = () => done(fr.result);
      fr.onerror = () => done(null);
      fr.readAsDataURL(file);
    });
    if (!dataUrl) return sayFailed('That file could not be read, so nothing was attached.');
    const r = await post('/api/pane/image', { dataUrl });
    if (!r.ok) return sayFailed(`That picture was not saved, so it cannot go with your message — ${r.error}`);
    shots.push({ path: r.path, src: r.src });
    paintShots();
    box.focus();
  };

  const sendText = async (text) => {
    // The agent is given each picture's path on its own line, above whatever you wrote —
    // that is how an agent in a terminal is handed a picture.
    const full = [...shots.map((s) => s.path), text].filter((s) => s.trim?.() ?? s).join('\n');
    if (!full.trim()) return;
    if (text.trim()) { history.push(text); historyAt = history.length; }
    const kept = shots;                      // put back if it turns out nothing was sent
    box.value = '';
    shots = [];
    paintShots();
    autoGrow(box);
    const r = await post('/api/pane/send', { id: paneId, text: full });
    // The severe one. Emptying the box on a send that failed erased the words as well as the
    // fact, and the 1.5s poll then cleared the banner, so a reply the agent never saw looked
    // exactly like one it had. Both come back, and the line above stays until you close it.
    if (!r.ok) {
      if (!box.value.trim()) { box.value = text; autoGrow(box); }
      if (!shots.length) { shots = kept; paintShots(); }
      sayFailed(`That reply did not send — ${r.error} It is back in the box below, and the agent has not seen it.`);
    } else sayWorked();
    setTimeout(refreshScreen, 350);
  };

  ov.addEventListener('click', (e) => {
    if (e.target === ov) return closeSheet();
    const view = e.target.closest('[data-view]')?.dataset.view;
    if (view) { setView(view); markView(ov); paintScreen(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeSheet();
    // Closing the notice is the operator saying he has read it — it is not an undo or a retry.
    if (act === 'seen') ov.querySelector('.act-error').hidden = true;
    if (act === 'send') sendText(box.value);
    if (act === 'enter') sendText('');
    if (act === 'tools') { setTools(!getTools()); markView(ov); paintScreen(); }
    if (act === 'fold') { setSmart(!getSmart()); markView(ov); paintScreen(); }
    if (act === 'size') { setSize(nextSize().key); markView(ov); paintScreen(); }
    if (act === 'full') {
      ov.classList.toggle('full');
      setFull(ov.classList.contains('full'));
      markView(ov);
      paintScreen();               // the width rule changed, so the text is re-measured
    }
    if (act === 'focus') post('/api/pane/focus', { id: paneId });
    if (act === 'mode' && !switching) {
      const now = readMode(clean(rawText));
      // Unknown means unknown: one press and another look, never a guessed run.
      goToMode(now === null ? null : (now === 'auto' ? 'normal' : 'auto'));
    }
    const KEYS = { 'key-escape': ['escape'], 'key-up': ['up'], 'key-down': ['down'] };
    // Picking option N sends which row it is; the server walks the menu to it.
    const opt = e.target.closest('[data-choice]');
    const press = KEYS[act] ? { keys: KEYS[act] }
      : opt ? { choice: opt.dataset.choice }
      : null;
    if (press) pressKeys(press);
    const jump = e.target.closest('[data-jump]');
    if (jump) ov.querySelector(`.blk.you[data-turn="${jump.dataset.jump}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const dropShot = e.target.closest('[data-drop-shot]');
    if (dropShot) { shots.splice(+dropShot.dataset.dropShot, 1); paintShots(); }
  });

  /* Three ways in, one behaviour: paste a screenshot, drag a file onto the panel, or use
     the Picture button. Anything that is not an image is ignored rather than guessed at. */
  const imagesIn = (list) => [...(list ?? [])].filter((f) => f?.type?.startsWith('image/'));
  ov.addEventListener('paste', (e) => {
    const files = imagesIn([...(e.clipboardData?.items ?? [])]
      .filter((i) => i.kind === 'file').map((i) => i.getAsFile()));
    if (!files.length) return;               // plain text paste is left completely alone
    e.preventDefault();
    files.forEach(attachImage);
  });
  ov.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  ov.addEventListener('drop', (e) => {
    const files = imagesIn(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    files.forEach(attachImage);
  });
  ov.querySelector('.file input').addEventListener('change', (e) => {
    imagesIn(e.target.files).forEach(attachImage);
    e.target.value = '';                     // so the same file can be picked again
  });

  // A menu option is a button, so Enter and Space pick it the same as a click.
  ov.addEventListener('keydown', (e) => {
    const opt = e.target.closest('[data-choice]');
    if (!opt || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    pressKeys({ choice: opt.dataset.choice });
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
  if (isWiring() || e.target.closest('[data-port], [data-move], .kind-menu')) return;
  const el = e.target.closest('[data-pane]');
  if (el && !e.target.closest('.overlay')) openSheet(el.dataset.pane, el.dataset.label, el.dataset.cwd);
}

// The full-page key presses the very button the mouse presses, so the two can never drift
// apart. Which letter it is, and the words explaining it, are in keys.js.
bindKey('full', () => document.querySelector('.agent-overlay [data-act="full"]')?.click());

/** Start listening for card clicks. Called once by main.js, after the page exists. */
export function watchCards() {
  document.addEventListener('click', openFromCard);
  // The name is a real button, so Enter and Space open the card by themselves. The one
  // thing to add: while a line is being drawn, those keys finish the line instead.
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card .open') && isWiring()) {
      e.preventDefault();
      finishFromKeyboard(e.target.closest('[data-pane]').dataset.pane);
    }
  });
}
