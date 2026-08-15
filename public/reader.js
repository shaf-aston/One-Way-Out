// Pure core (runs in the browser, no DOM): the agent's coloured screen -> HTML.
//
// Claude Code already formats its own output — bold headings, grey tool results, faded
// hints. The terminal keeps that as ANSI colour codes. So nothing here decides what
// "important" looks like: it decodes what the agent itself drew and re-renders it.
import { esc } from './ui.js';

const SGR = /\[([0-9;]*)m/g;
const rgb = (r, g, b) => `rgb(${r} ${g} ${b})`;

/** One 8-bit palette entry -> css. Only the greys matter in practice; the rest are approximated. */
const ansi256 = (n) => (n >= 232
  ? rgb(8 + (n - 232) * 10, 8 + (n - 232) * 10, 8 + (n - 232) * 10)
  : n < 8 ? `var(--ansi-${n})` : `var(--ansi-${n % 8})`);

/**
 * Split ANSI text into lines of styled runs.
 * @returns {Array<Array<{t:string,b:boolean,d:boolean,c:string|null,hl:boolean}>>}
 */
export function parseAnsi(text) {
  let st = { b: false, d: false, c: null, hl: false };
  const lines = [[]];
  const push = (t) => {
    if (!t) return;
    for (const [i, part] of t.split('\n').entries()) {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...st, t: part });
    }
  };

  const s = String(text ?? '').replace(/\r/g, '');
  let at = 0;
  for (const m of s.matchAll(SGR)) {
    push(s.slice(at, m.index));
    at = m.index + m[0].length;
    const codes = m[1].split(';').filter(Boolean).map(Number);
    if (!codes.length) codes.push(0);
    for (let i = 0; i < codes.length; i += 1) {
      const c = codes[i];
      if (c === 0) st = { b: false, d: false, c: null, hl: false };
      else if (c === 1) st = { ...st, b: true };
      else if (c === 2) st = { ...st, d: true };
      else if (c === 22) st = { ...st, b: false, d: false };
      else if (c === 39) st = { ...st, c: null };
      else if (c === 49) st = { ...st, hl: false };
      else if (c === 38 || c === 48) {
        const mode = codes[i + 1];
        const val = mode === 2 ? rgb(codes[i + 2], codes[i + 3], codes[i + 4]) : ansi256(codes[i + 2]);
        i += mode === 2 ? 4 : 2;
        st = c === 38 ? { ...st, c: val } : { ...st, hl: true };
      }
    }
  }
  push(s.slice(at));
  return lines;
}

const plain = (runs) => runs.map((r) => r.t).join('');
const blank = (runs) => !plain(runs).trim();

/** A run -> one span. Colour comes from the agent; the CSS only tones it down. */
const span = (r) => {
  const cls = [r.b && 'b', r.d && 'd', r.hl && 'hl'].filter(Boolean).join(' ');
  const style = r.c ? ` style="color:${r.c}"` : '';
  return `<span${cls ? ` class="${cls}"` : ''}${style}>${esc(r.t)}</span>`;
};

/** Terminal view: the screen as it is, coloured, wrapped to the panel. */
export const toTerminal = (lines) => lines.map((l) => l.map(span).join('')).join('\n');

/*
 * The terminal draws its own structure with a small set of glyphs at the front of a line.
 * That is the only vocabulary the reader interprets — one table, changed in one place.
 *   flow:true  = wrapped fragments of one thought, joined back into a paragraph
 *   flow:false = kept line for line, because it is output or code and wrapping it lies
 */
const ROLES = [
  { name: 'you',    open: /^\s*[❯>]\s?/u,        flow: true  },  // what you typed
  { name: 'say',    open: /^\s*[●⏺]\s?/u,        flow: true  },  // the agent talking or acting
  { name: 'out',    open: /^\s*[⎿└├]\s{0,2}/u,   flow: false },  // what a tool gave back
  { name: 'note',   open: /^\s*[✻✽✢✳✶·]\s?/u,    flow: true  },  // thinking / spinner
  { name: 'chrome', open: /^\s*(?:\[[^\]]+\]\s+[\d.]+k|⏵⏵|⧉)/u, flow: false }, // the app's own status bar
];
const HEAD = /^\s*(#{1,4})\s+(.*)$/;
const bullet = (t) => /^\s*(?:[-*+•]|\d+[.)])\s/u.test(t);

/** Drop the leading glyph — the layout says what it said, so showing it twice is noise. */
function strip(runs, re) {
  const out = runs.map((r) => ({ ...r }));
  let left = (re.exec(plain(runs)) || [''])[0].length;
  for (const r of out) {
    if (left <= 0) break;
    const take = Math.min(left, r.t.length);
    r.t = r.t.slice(take);
    left -= take;
  }
  return out.filter((r) => r.t);
}

/**
 * Split the screen into the same blocks Reader and the block log both build on: one entry
 * per turn/tool-call, in order, each carrying which role it is and its rows of styled runs.
 * @returns {Array<{role:{name:string,flow:boolean}, rows:Array}>}
 */
function toBlocks(lines) {
  const blocks = [];
  let open = null;
  const close = () => {
    if (!open) return;
    if (open.rows.some((r) => plain(r).trim())) blocks.push(open);  // an empty prompt is not a turn
    open = null;
  };

  for (const runs of lines) {
    if (blank(runs)) { close(); continue; }
    const text = plain(runs);
    const head = HEAD.exec(text);
    if (head) { close(); blocks.push({ role: { name: 'head', flow: true }, rows: [], heading: head[2] }); continue; }

    const role = ROLES.find((r) => r.open.test(text));
    if (role) {
      close();
      open = { role, rows: [strip(runs, role.open)] };
    } else if (open && !bullet(text)) {
      open.rows.push(runs);                       // a wrapped continuation of the open block
    } else {
      close();
      open = { role: { name: bullet(text) ? 'item' : 'say', flow: true }, rows: [runs] };
    }
  }
  close();
  return blocks;
}

const flowText = (rows) => rows.flatMap((r, i) => (i ? [{ ...r[0], t: ' ' }, ...r] : r))
  .map((r) => ({ ...r, t: r.t.replace(/\s+/g, ' ') }));

/**
 * Reader view: the same words and the same colours, laid out for reading.
 * Terminals wrap a sentence into four fragments; those are joined back into one paragraph
 * that fills the panel. Tool output and code keep their line breaks. Nothing is added,
 * removed or reordered — only re-arranged.
 */
export function toReader(lines) {
  return toBlocks(lines).map((b) => {
    if (b.role.name === 'head') return `<h4>${esc(b.heading)}</h4>`;
    return b.role.flow
      ? `<p class="${b.role.name}">${flowText(b.rows).map(span).join('')}</p>`
      : `<pre class="${b.role.name}">${b.rows.map((r) => r.map(span).join('')).join('\n')}</pre>`;
  }).join('');
}

/** Which blocks are the agent talking to you, and which are it running/reading tools. */
const isTool = (name) => name === 'out' || name === 'chrome';

/**
 * The exact key presses that land on option `n` of a menu of `total`.
 * The menu remembers where it was, so we do not know the highlight's position: press Up
 * enough times to be certainly at the top, then Down to the wanted row. Deterministic,
 * and it uses only the two keys the prompt itself says it accepts.
 */
export const chooseKeys = (n, total) =>
  [...Array(Math.max(0, total - 1)).fill('up'), ...Array(Math.max(0, n - 1)).fill('down'), 'enter'];

const NUMBERED = /^\s*(\d+)[.)]\s+\S/;

/**
 * A menu Claude is waiting on: the run of numbered options at the very end of the screen.
 * Only the last run counts — an old menu further up has already been answered, and offering
 * to click it would send keys to a prompt that is no longer there.
 * @returns {number[]} the block indexes of the options, in order
 */
function liveMenu(blocks) {
  const at = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    const text = b.rows.length ? plain(b.rows[0]) : '';
    const num = NUMBERED.exec(text);
    if (num) { at.unshift({ i, n: Number(num[1]) }); continue; }
    // The prompt's own footer sits under the options; anything else ends the run.
    if (at.length) break;
    if (!/Enter to select|to navigate|Esc to cancel/i.test(text)) {
      if (b.role.name !== 'chrome' && text.trim()) break;
    }
  }
  // A real menu counts 1,2,3… from the top; anything else is prose that happens to be numbered.
  return at.every((x, k) => x.n === k + 1) && at.length > 1 ? at.map((x) => x.i) : [];
}

/**
 * Block log: one full-width strip per turn or tool call, in the order they happened —
 * Warp's block model. Talk (you/say/notes) always shows. A *run* of consecutive tool
 * calls folds into one collapsed group headed by its count, so a wall of tool noise
 * reads as a single line until it is asked for; the page's Tools toggle can still hide
 * the groups entirely without this module knowing about that toggle.
 * Your own messages carry `data-turn` so the page can list them as jump points.
 */
export function toLog(lines) {
  const html = [];
  let toolRun = [];      // consecutive tool blocks waiting to fold into one group
  let turn = 0;
  const flush = () => {
    if (!toolRun.length) return;
    html.push(`<details class="tool-run"><summary>${toolRun.length} tool call${toolRun.length === 1 ? '' : 's'}</summary>${toolRun.join('')}</details>`);
    toolRun = [];
  };

  const blocks = toBlocks(lines);
  const menu = liveMenu(blocks);
  let seen = -1;
  for (const b of blocks) {
    seen += 1;
    if (b.role.name === 'head') { flush(); html.push(`<h4>${esc(b.heading)}</h4>`); continue; }
    const tool = isTool(b.role.name);
    const body = b.role.flow
      ? `<p>${flowText(b.rows).map(span).join('')}</p>`
      : `<pre>${b.rows.map((r) => r.map(span).join('')).join('\n')}</pre>`;
    const tag = tool ? `<div class="blk-tag">${b.role.name === 'chrome' ? 'status' : 'tool'}</div>` : '';
    const anchor = b.role.name === 'you' ? ` data-turn="${(turn += 1)}"` : '';
    // An option of the menu Claude is waiting on becomes something you can just click.
    const pick = menu.indexOf(seen);
    const choice = pick < 0 ? ''
      : ` data-choice="${pick + 1}" data-choice-of="${menu.length}" role="button" tabindex="0"`;
    const blk = `<div class="blk ${b.role.name} ${tool ? 'tool' : 'talk'}${pick < 0 ? '' : ' choice'}"${anchor}${choice}>${tag}${body}</div>`;
    if (tool) toolRun.push(blk);
    else { flush(); html.push(blk); }
  }
  flush();
  return html.join('');
}

/* ── Which mode the agent is working in ──
   Claude prints its own mode on its status line ("auto mode on (shift+tab to cycle)").
   Reading it is the difference between switching TO a mode and pressing shift+tab a
   guessed number of times. The words belong to Claude, not to us: when it renames them
   this returns null, and the UI must say "unknown" rather than pretend. */

/** The modes shift+tab cycles through, in the order it cycles them. */
export const MODES = {
  normal: { label: 'Asks before each step' },
  auto: { label: 'Accepting all plans' },
  plan: { label: 'Planning only' },
};

/**
 * Read the agent's current mode off its own screen.
 * @param {string} text - the pane as plain text
 * @returns {'normal'|'auto'|'plan'|null} null when the screen does not say
 */
export function readMode(text) {
  // Only the last lines: the status line is the bottom of the screen, and an older mention
  // scrolled up the transcript is history, not the mode it is in now.
  const tail = String(text ?? '').split('\n').slice(-6).join('\n').toLowerCase();
  if (/plan mode on/.test(tail)) return 'plan';
  if (/auto mode on|accept edits on|auto-accept edits on/.test(tail)) return 'auto';
  // A prompt with no mode banner is the plain one — but only if a prompt is visible at all.
  if (/shift\+tab|⏵⏵/.test(tail)) return 'normal';
  return null;
}

/**
 * How many shift+tab presses go from one mode to another. Each press is still checked
 * against the screen afterwards; this only says where to aim.
 * @returns {number} 0 when already there, -1 when either end is unknown
 */
export function stepsToMode(from, to) {
  const order = Object.keys(MODES);
  const a = order.indexOf(from), b = order.indexOf(to);
  if (a < 0 || b < 0) return -1;
  return (b - a + order.length) % order.length;
}
