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
  // A highlighted run of nothing but spaces is the terminal padding its rows out to the
  // edge of a coloured box. Drawn here it is a grey bar hanging off the end of every line.
  const cls = [r.b && 'b', r.d && 'd', r.hl && r.t.trim() && 'hl'].filter(Boolean).join(' ');
  const style = r.c ? ` style="color:${r.c}"` : '';
  return `<span${cls ? ` class="${cls}"` : ''}${style}>${esc(r.t)}</span>`;
};

/** Terminal view: the screen as it is, coloured, wrapped to the panel. A real terminal pads
 * blank rows down to its fixed height (often to pin a status line at the bottom) — showing
 * that padding here would just be empty space, so a run of blank rows collapses to one.
 * Every row is an element, not text between elements: the viewer updates the screen child by
 * child, and a bare newline is not a child — measured 2026-09-03, every row ran into the next. */
export const toTerminal = (lines) => {
  const out = [];
  let blanks = 0;
  for (const l of collapseRepaints(lines)) {
    if (blank(l)) { blanks += 1; continue; }
    if (out.length && blanks) out.push([]);
    blanks = 0;
    out.push(l);
  }
  return out.map((l) => `<div class="row">${l.map(span).join('')}</div>`).join('');
};

/*
 * The terminal draws its own structure with a small set of glyphs at the front of a line.
 * That is the only vocabulary the reader interprets — one table, changed in one place.
 *   flow:true  = wrapped fragments of one thought, joined back into a paragraph
 *   flow:false = kept line for line, because it is output or code and wrapping it lies
 */
/** The glyphs a spinner draws itself with — named once and used by both the role table and
 *  the live-status collapse below, so the two can never drift apart. */
const SPIN = '✻✽✢✳✶·';
const ROLES = [
  { name: 'you',    open: /^\s*[❯>]\s?/u,        flow: true  },  // what you typed
  { name: 'say',    open: /^\s*[●⏺]\s?/u,        flow: true  },  // the agent talking or acting
  { name: 'out',    open: /^\s*[⎿└├]\s{0,2}/u,   flow: false },  // what a tool gave back
  { name: 'note',   open: new RegExp(`^\\s*[${SPIN}]\\s?`, 'u'), flow: true },  // thinking / spinner
  { name: 'chrome', open: /^\s*(?:\[[^\]]+\]\s+[\d.]+k|⏵⏵|⧉)/u, flow: false }, // the app's own status bar
];
const HEAD = /^\s*(#{1,4})\s+(.*)$/;
const bullet = (t) => /^\s*(?:[-*+•]|\d+[.)])\s/u.test(t);
/** A table row — markdown `|`, or Claude Code's box drawing (`│` cells, `┌├└` rules).
 *  Joining these into a paragraph turns a table into pipe soup. */
const TABLE = /^\s*(?:[|│].*[|│]|[┌├└][─┬┼┴┐┤┘]+)\s*$/u;
/** A line that only draws a rule (|---|, ├──┼──┤): it is not data. */
const RULE = /^[\s|:─┌┐└┘├┤┬┴┼-]+$/u;

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
/** A row drawn entirely in the terminal's highlight — Claude Code paints your own message
 *  that way, every row of it, so the highlight is what says a row is still yours. */
const yours = (runs) => runs.length > 0 && runs.every((r) => r.hl);
/** The next row with words on it, from `at` onward. */
const nextText = (lines, at) => lines.slice(at).find((l) => !blank(l));

function toBlocks(lines) {
  const blocks = [];
  let open = null;
  const close = () => {
    if (!open) return;
    if (open.rows.some((r) => r && plain(r).trim())) blocks.push(open);  // an empty prompt is not a turn
    open = null;
  };

  for (const [i, runs] of lines.entries()) {
    if (blank(runs)) {
      // A blank line inside your message is a paragraph break, not the end of the turn —
      // measured 2026-09-03, a three-paragraph message came out as one "you" block and two
      // blocks credited to the agent. `null` marks the break; the log draws it as a new <p>.
      const next = nextText(lines, i + 1);
      if (open?.role.name === 'you' && next && yours(next) && !ROLES.some((r) => r.open.test(plain(next)))) {
        open.rows.push(null);
      } else close();
      continue;
    }
    if (open?.role.name === 'you' && yours(runs) && !ROLES.some((r) => r.open.test(plain(runs)))) {
      open.rows.push(runs);                       // still your words, bullets included
      continue;
    }
    const text = plain(runs);
    const head = HEAD.exec(text);
    if (head) { close(); blocks.push({ role: { name: 'head', flow: true }, rows: [], heading: head[2] }); continue; }

    if (TABLE.test(text)) {
      if (open?.role.name !== 'table') { close(); open = { role: { name: 'table', flow: false }, rows: [] }; }
      open.rows.push(runs);
      continue;
    }

    const role = ROLES.find((r) => r.open.test(text));
    if (role) {
      close();
      open = { role, rows: [strip(runs, role.open)] };
    } else if (open && open.role.name !== 'table' && !bullet(text)) {
      open.rows.push(runs);                       // a wrapped continuation of the open block
    } else {
      close();
      open = { role: { name: bullet(text) ? 'item' : 'say', flow: true }, rows: [runs] };
    }
  }
  close();
  return blocks;
}

/**
 * Cut one table row at its `|` characters, keeping every colour and bold the agent used.
 * The outer pipes leave an empty cell at each end; those are the border, not a column.
 */
function cells(runs) {
  const out = [[]];
  for (const r of runs) {
    r.t.split(/[|│]/u).forEach((t, i) => {
      if (i) out.push([]);
      if (t) out[out.length - 1].push({ ...r, t });
    });
  }
  if (!plain(out[0]).trim()) out.shift();
  if (out.length && !plain(out[out.length - 1]).trim()) out.pop();
  // The padding around a cell is the table's own spacing, and the CSS puts it back.
  return out.map((c) => c.map((r, i) => ({ ...r, t: i ? r.t : r.t.replace(/^\s+/, '') }))
    .map((r, i, a) => (i === a.length - 1 ? { ...r, t: r.t.replace(/\s+$/, '') } : r))
    .filter((r) => r.t));
}

/** A markdown table drawn as a real table, so its columns line up whatever the width. */
function toTable(rows) {
  // A box table wraps a long cell onto extra lines and only its ├─┼─┤ rule ends a row, so
  // those lines are one row: each column's pieces are joined back with a space.
  const box = rows.some((r) => plain(r).includes('│'));
  const groups = [];
  let cur = null;
  for (const r of rows) {
    if (RULE.test(plain(r))) { cur = null; continue; }
    if (!box || !cur) groups.push((cur = []));
    cur.push(cells(r));
  }
  const merge = (g) => Array.from({ length: Math.max(...g.map((c) => c.length)) }, (_, i) => g
    .map((c) => c[i] || []).filter((p) => plain(p).trim())
    .flatMap((p, k) => (k ? [{ ...p[0], t: ' ' }, ...p] : p)));
  const body = groups.map(merge);
  const head = body.length > 1 && rows.length > groups.flat().length ? body.shift() : null;
  const tr = (cs, tag) => `<tr>${cs.map((c) => `<${tag}>${c.map(span).join('').trim()}</${tag}>`).join('')}</tr>`;
  return `<table class="md">${head ? `<thead>${tr(head, 'th')}</thead>` : ''}`
    + `<tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table>`;
}

/** The rows of a wrapped thought, joined back into one line of runs. Each row's own edges are
 *  trimmed first: the terminal indents continuation rows, and joining them as they are put a
 *  double space at every former line end. */
const trimRow = (row) => {
  const out = row.map((r) => ({ ...r }));
  if (out.length) out[0].t = out[0].t.replace(/^\s+/, '');
  if (out.length) out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
  return out.filter((r) => r.t);
};
const flowText = (rows) => rows.map(trimRow).filter((r) => r.length)
  .flatMap((r, i) => (i ? [{ ...r[0], t: ' ' }, ...r] : r))
  .map((r) => ({ ...r, t: r.t.replace(/\s+/g, ' ') }));
/** Rows split at the paragraph breaks toBlocks marked with null. */
const paragraphs = (rows) => rows.reduce((ps, r) => { if (r === null) ps.push([]); else ps[ps.length - 1].push(r); return ps; }, [[]])
  .filter((p) => p.length);

/** Which blocks are the agent talking to you, and which are it running/reading tools. */
const isTool = (name) => name === 'out' || name === 'chrome';
/* ── Which ● blocks are tool calls ──
 * Claude Code gives a call and a reply the same ●, and tools come and go, so a list of tool
 * names would always be out of date. The screen's own structure tells them apart instead:
 *   1. a call header is a capitalised name glued to its bracket — `Bash(…)`, `Workflow(…)` —
 *      or an MCP call `server - tool (MCP)`
 *   2. a ● block followed straight away by a ⎿ result is a call: only tools print results
 *   3. Claude marks the call itself — "(ctrl+o to expand)" or "(exit code N)" on its first
 *      line or at its very end (a long notice wraps, even inside the mark); a glyph-less
 *      piece ending that way is the tail of a call's output
 *   4. a later line that opens with a name rule 1 already saw, then a quote or a colon —
 *      `Monitor event: …`, `Monitor "…" stopped` — is that tool reporting back
 *   5. a quoted command cut into pieces by its own blank lines (see below)
 * Measured 2026-09-16 on two live panes: before this, every call counted as talk and broke
 * the fold after each one. */
const CALL_HEAD = /^\s*(?:([A-Z][A-Za-z]*)\(|\S+ - \S+ \(MCP\))/u;
// Claude's own marks on a call. Spaces are \s+ because the terminal can wrap inside one.
const CALL_MARK = /\((?:ctrl\+o\s+to\s+expand|exit\s+code\s+-?\d+)\)/;
const ENDS_MARKED = new RegExp(`${CALL_MARK.source}\\s*$`);

/** The indexes of the blocks that are really tool calls. Pure: reads the blocks, nothing else. */
export function findCalls(blocks) {
  const text = (b) => b.rows.filter(Boolean).map(plain);
  const ends = (b) => ENDS_MARKED.test(text(b).join(' '));
  const names = new Set(blocks.filter((b) => b.role.name === 'say')
    .map((b) => CALL_HEAD.exec(text(b)[0] ?? '')?.[1]).filter(Boolean));
  // Names are letters only (CALL_HEAD), so they go into the pattern as they are.
  const known = names.size ? new RegExp(`^\\s*(?:${[...names].join('|')})\\b[^.!?]*?(?:"|:\\s)`, 'u') : null;
  const calls = new Set();
  blocks.forEach((b, i) => {
    const glyph = ROLES.includes(b.role);
    // A piece with no glyph of its own that ends in Claude's mark is the tail of a call's
    // output ("… +93 lines (ctrl+o to expand)") — whatever it looked like, bullet or prose.
    if (!glyph && (b.role.name === 'say' || b.role.name === 'item') && ends(b)) { calls.add(i); return; }
    if (b.role.name !== 'say') return;
    const first = text(b)[0] ?? '';
    if (CALL_HEAD.test(first) || blocks[i + 1]?.role.name === 'out'
      || CALL_MARK.test(first) || ends(b) || known?.test(first)) calls.add(i);
    // 5. A ● line that opens a quote and carries no mark yet: the quoted command had blank
    //    lines, so the notice was cut into pieces. If the piece just before the next ●/❯ line
    //    ends with the mark, every piece in between is that one call.
    else if (glyph && first.includes('"')) {
      let j = i + 1;
      while (blocks[j] && !ROLES.includes(blocks[j].role)) j += 1;
      if (j - 1 > i && ends(blocks[j - 1])) for (let k = i; k < j; k += 1) calls.add(k);
    }
  });
  return calls;
}

import { readMenu } from './menu.js';

const NUMBERED = /^\s*(\d+)[.)]\s+\S/;

/* ── The live status region, drawn once ──
 *
 * Claude Code repaints its spinner and its todo list in place every second or so. Herdr's
 * capture records every repaint as NEW lines instead of overwriting the old ones (measured
 * 2026-09-01: `agent read --source visible`, which is meant to be "the screen right now",
 * already carried six stacked copies of one block), so the same widget arrives here twenty-odd
 * times over. That is Herdr's own bug and this app cannot fix it — but it must not show it.
 *
 * The rule is deliberately the one that CANNOT hide anything: inside a run of repaints the
 * newest frame is kept whole and verbatim, and every line an earlier frame drew that the
 * newest one does not is kept too, in the order it arrived. So a row that only ever appeared
 * once — a granted timeout, a permission decision, a todo the newest frame was still halfway
 * through drawing — stays on screen. Nothing is put behind a fold: the viewer rebuilds this
 * HTML every 1.5s and only remembers which TOOL groups were open, so anything folded here
 * would slam shut before it could be read.
 *
 * The one thing deliberately dropped is the elapsed clock of the older frames. A spinner's
 * counter is a live readout, not transcript, and only its newest value is true.
 */

/**
 * A frame header: a spinner glyph, then an elapsed clock INSIDE brackets. The brackets are
 * load-bearing — they separate a live "Channeling… (24m 54s · ↓ 32.1k tokens)" from a
 * finished "✻ Baked for 24m 16s · done 12:48", which is real transcript and must not collapse.
 */
const FRAME_HEAD = new RegExp(`^\\s*[${SPIN}]\\s.*\\((?:\\d+h\\s)?(?:\\d+m\\s)?\\d+s[\\s·)]`, 'u');
/** What a frame's body looks like: a tool-result glyph, a todo box, or an indented wrap. */
const FRAME_BODY = /^(?:\s*[⎿└├◻◼☐☑✓✔]|\s*[─━]|\s{2,}\S)/u;

/**
 * Two lines are the same row of the same widget when their words match. The box-drawing
 * crumbs Herdr splices into a torn repaint (measured: literal ─ bytes sitting inside words)
 * are flattened out, or a torn frame would never match the clean twin it is a copy of.
 */
const rowKey = (t) => t.replace(/[─━│┃…]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Split a run of repaints into its frames, starting at the header on line `at`.
 * The run ends at the first non-blank line that is neither a header nor frame body — that
 * single guard is what keeps real transcript out of a collapsed span. A numbered menu line
 * never counts as body: those are the options the viewer lets you click, and swallowing one
 * would mean pressing keys for a row that is no longer on screen.
 * @returns {{frames: Array<{head: Array, rows: Array}>, end: number}}
 */
function readRun(lines, at) {
  const frames = [];
  let i = at;
  while (i < lines.length) {
    const t = plain(lines[i]);
    if (!t.trim()) { i += 1; continue; }                       // blanks separate frames
    if (FRAME_HEAD.test(t)) { frames.push({ head: lines[i], rows: [] }); i += 1; continue; }
    if (frames.length && FRAME_BODY.test(t) && !NUMBERED.test(t)) {
      frames[frames.length - 1].rows.push(lines[i]);
      i += 1;
      continue;
    }
    break;
  }
  return { frames, end: i };
}

/**
 * Draw each run of repaints once. Pure lines in, lines out, so both views share it: Reader
 * has a block model and Terminal does not, and the duplication is a property of the lines.
 * @param {Array<Array<object>>} lines - from parseAnsi
 */
export function collapseRepaints(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!FRAME_HEAD.test(plain(lines[i]))) { out.push(lines[i]); i += 1; continue; }

    const { frames, end } = readRun(lines, i);
    // One frame is not a repaint, it is just the agent working. Leave the run exactly as it is.
    if (frames.length < 2) { for (; i < end; i += 1) out.push(lines[i]); continue; }

    const newest = frames[frames.length - 1];
    const shown = new Set(newest.rows.map((r) => rowKey(plain(r))));
    for (const f of frames.slice(0, -1)) {
      for (const r of f.rows) {
        const k = rowKey(plain(r));
        if (shown.has(k)) continue;       // the newest frame, or an earlier one, already says it
        shown.add(k);
        out.push(r);
      }
    }
    out.push(newest.head);
    // The widget repeats itself inside one frame too. A row identical to the one above it is
    // dropped, which is lossless by construction: that text is still there, one line up.
    let above = null;
    for (const r of newest.rows) {
      const k = rowKey(plain(r));
      if (k === above) continue;
      above = k;
      out.push(r);
    }
    i = end;
  }
  return out;
}

/**
 * The words of a menu row, with whatever the terminal put in front of them taken off —
 * the highlight glyph, and the number if it is a numbered menu. This is what a row is
 * matched by everywhere: the number moves as the highlight moves, the words do not.
 */
const bareLabel = (text) => String(text ?? '')
  .replace(/^\s*[❯>▶►]?\s*/u, '')
  .replace(/^(\d+)[.)]\s+/, '')
  .trim();

/**
 * A menu with no numbers — the trust question every new agent opens with — is drawn as one
 * paragraph, because its rows are plain prose lines and the reader joins those. Split them
 * back apart so each row can be a button of its own. Only rows the menu grammar already
 * recognised are split out, so ordinary prose is never taken apart.
 */
function splitMenuRows(blocks, labels) {
  if (!labels.size) return blocks;
  const out = [];
  for (const b of blocks) {
    const rows = (b.rows ?? []).filter(Boolean);
    if (rows.length < 2 || !rows.some((r) => labels.has(bareLabel(plain(r))))) { out.push(b); continue; }
    for (const r of rows) out.push({ ...b, rows: [r] });
  }
  return out;
}

/**
 * Where each option of the menu the agent is waiting on ended up, once the blocks are built.
 * The grammar in menu.js decides what a menu IS and which run of lines is the live one; this
 * only finds those rows again among the blocks. Every option must be found or none are
 * offered — half a menu on screen would send a keypress to a row that is not there.
 * @returns {Array<{i:number,label:string}>} block index and words, in screen order
 */
function liveMenu(blocks, menu) {
  if (!menu.length) return [];
  const want = new Set(menu.map((o) => o.label));
  const at = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (!b.rows?.[0]) continue;
    const label = bareLabel(plain(b.rows[0]));
    if (want.has(label) && !at.some((x) => x.label === label)) { at.unshift({ i, label }); continue; }
    if (at.length === menu.length) break;
  }
  return at.length === menu.length ? at : [];
}

/**
 * Block log: one full-width strip per turn or tool call, in the order they happened —
 * Warp's block model. Talk (you/say/notes) always shows. A *run* of consecutive tool
 * calls folds into one collapsed group headed by its count, so a wall of tool noise
 * reads as a single line until it is asked for. `smart` (the default) also folds the ● call
 * lines themselves (findCalls); off, only their ⎿ results fold; the page's Tools toggle can still hide
 * the groups entirely without this module knowing about that toggle.
 * Your own messages carry `data-turn` so the page can list them as jump points.
 */
export function toLog(lines, { smart = true } = {}) {
  const html = [];
  let toolRun = [];      // consecutive tool blocks waiting to fold into one group
  let calls = 0;         // calls in that run — a call's ⎿ result is part of it, not another call
  let turn = 0;
  const flush = () => {
    if (!toolRun.length) return;
    html.push(`<details class="tool-run"><summary>${calls} tool call${calls === 1 ? '' : 's'}</summary>${toolRun.join('')}</details>`);
    toolRun = [];
    calls = 0;
  };

  // What the grammar says is on screen, then where those rows landed among the blocks.
  const rows = collapseRepaints(lines);
  const menu = readMenu(rows.map((l) => plain(l)).join('\n'));
  const blocks = splitMenuRows(toBlocks(rows), new Set(menu.map((o) => o.label)));
  const at = liveMenu(blocks, menu);
  const callAt = smart ? findCalls(blocks) : new Set();   // basic: only ⎿ results and status fold
  let seen = -1;
  for (const b of blocks) {
    seen += 1;
    const tool = isTool(b.role.name) || callAt.has(seen);
    if (b.role.name === 'head' && !tool) { flush(); html.push(`<h4>${esc(b.heading)}</h4>`); continue; }
    // A `# comment` inside a folded command is code, not a heading: keep it as a plain line.
    const body = b.role.name === 'head' ? `<pre>${esc(`# ${b.heading}`)}</pre>` : b.role.name === 'table' ? toTable(b.rows) : b.role.flow
      ? paragraphs(b.rows).map((p) => `<p>${flowText(p).map(span).join('')}</p>`).join('')
      : `<pre>${b.rows.map((r) => r.map(span).join('')).join('\n')}</pre>`;
    const name = tool && b.role.name === 'say' ? 'call' : b.role.name;  // a ● tool call, not talk
    const tag = tool ? `<div class="blk-tag">${b.role.name === 'chrome' ? 'status' : 'tool'}</div>` : '';
    const anchor = b.role.name === 'you' ? ` data-turn="${(turn += 1)}"` : '';
    // An option of the menu Claude is waiting on becomes something you can just click. It
    // carries its WORDS, not its row number: the highlight moves as the keys land, so the
    // number is stale by the time it is pressed — the words are not.
    const hit = at.find((x) => x.i === seen);
    const choice = hit ? ` data-choice="${esc(hit.label)}" role="button" tabindex="0"` : '';
    const blk = `<div class="blk ${name} ${tool ? 'tool' : 'talk'}${hit ? ' choice' : ''}"${anchor}${choice}>${tag}${body}</div>`;
    if (tool) {
      // Only a line with its own glyph starts a call; a ⎿ result or a cut-off piece belongs to the one before.
      if ((ROLES.includes(b.role) && b.role.name !== 'out') || !toolRun.length) calls += 1;
      toolRun.push(blk);
    }
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

