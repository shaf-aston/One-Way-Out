// The grammar of a menu Claude Code is waiting on. Pure: no DOM, no I/O, no HTTP.
//
// It lives here, beside the reader, because BOTH sides need exactly one copy of it: the
// browser turns each row into a button (public/reader.js) and the server walks the highlight
// to the row you picked (src/answer.mjs). Two copies of a grammar drift, and a drifted menu
// grammar presses Enter on the wrong row of a live agent. scripts/verify.mjs already imports
// pure logic out of public/ for the same reason.
/** How many options a menu may have before we refuse to walk it with arrow keys. */
export const MAX_OPTIONS = 20;

/**
 * One row of a menu Claude is showing: which row it is, its words, and whether the
 * highlight is sitting on it right now.
 *
 * Two shapes exist and both must be read, because the second one is the very first
 * thing every new agent shows:
 *   numbered   `❯ 1. Resume from summary (recommended)`
 *   cursor     `❯ No, exit`  above  `  Yes, I trust this folder`
 * @typedef {{n:number,label:string,here:boolean}} Row
 */

/** The highlight. An unknown glyph is not guessed at — the row simply reads as not-here,
 *  and a walk that cannot see the highlight refuses to press anything. */
const CURSOR = '❯▶►';
const NUMBERED = new RegExp(`^\\s*([${CURSOR}])?\\s*(\\d+)[.)]\\s+(\\S.*?)\\s*$`, 'u');
const CURSORED = new RegExp(`^(\\s*)([${CURSOR}])\\s+(\\S.*?)\\s*$`, 'u');
const INDENTED = /^(\s*)(\S.*?)\s*$/u;

/**
 * The last run of lines numbered 1,2,3… A run that does not start at 1, or is a single line,
 * is prose that happens to be numbered — not a menu.
 * @returns {{rows:Row[], end:number}} `end` is the line after the run, so the caller can see
 *   what follows it.
 */
function numberedMenu(lines) {
  let best = { rows: [], end: 0 };
  let run = [];
  let from = 0;
  const close = (upto) => {
    if (run.length > 1 && run.every((o, k) => o.n === k + 1)) best = { rows: run, end: upto };
    run = [];
  };
  for (const [i, line] of lines.entries()) {
    const m = NUMBERED.exec(line);
    if (!m) { close(from); continue; }
    if (!run.length) from = i;
    run.push({ n: Number(m[2]), label: m[3], here: !!m[1] });
    from = i + 1;
  }
  close(from);
  return best;
}

/**
 * A menu with no numbers in it: a run of neighbouring lines whose WORDS all start at the same
 * column, exactly one of which carries the highlight. The highlight sits in the margin before
 * that column, which is why the column is measured from the words and not from the line.
 *
 * Both halves of the rule are load-bearing. Without the same-column test, a wrapped sentence
 * under the highlighted row becomes an option; without the exactly-one-highlight test, any
 * indented list becomes a menu. Getting this wrong sends arrow keys and Enter into a running
 * agent, so it fails closed — and the highlight may be on ANY row, because it moves as the
 * keys land and the screen is read again between every press.
 * @returns {{rows:Row[], end:number}}
 */
function cursorMenu(lines) {
  let best = { rows: [], end: 0 };
  let run = [];
  let col = null;
  let from = 0;
  const close = () => {
    if (run.length > 1 && run.filter((o) => o.here).length === 1) best = { rows: run, end: from };
    run = []; col = null;
  };
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) { close(); continue; }
    const c = CURSORED.exec(line);
    const p = INDENTED.exec(line);
    if (!c && !p) { close(); continue; }
    const starts = c
      ? line.length - line.slice(c[1].length + c[2].length).replace(/^\s+/, '').length
      : p[1].length;
    if (col !== null && col !== starts) close();
    col = starts;
    run.push({ label: c ? c[3] : p[2], here: !!c });
    from = i + 1;
  }
  close();
  return { rows: best.rows.map((o, i) => ({ n: i + 1, label: o.label, here: o.here })), end: best.end };
}

/**
 * The agent talking, or a tool reporting back. Seeing either of these below a menu means the
 * menu has already been answered and the conversation moved on.
 */
const SPOKE = /^\s*[●⏺⎿]/u;

/** How many non-blank lines may sit between the options and the bottom of the screen. */
const MAX_TAIL = 8;

/**
 * The menu the agent is waiting on RIGHT NOW, whichever shape it is. Numbered wins when both
 * could match, because a number is the more certain signal.
 *
 * Live matters as much as the shape. An older menu further up the screen has already been
 * answered, and pressing its keys would send them into whatever the agent did next — so a
 * menu counts only while nothing below it is the agent speaking or a tool reporting, and only
 * while the tail below it is short. Measured against Claude Code's own `/model` menu, which
 * prints a control line and a key hint under its options: the tail is real, but it is small
 * and it never speaks.
 *
 * @param {string} text - the pane's screen as plain text
 * @returns {Row[]} in screen order, empty when there is no live menu
 */
export function readMenu(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const numbered = numberedMenu(lines);
  const found = numbered.rows.length ? numbered : cursorMenu(lines);
  if (!found.rows.length) return [];
  const tail = lines.slice(found.end).filter((l) => l.trim());
  if (tail.length > MAX_TAIL || tail.some((l) => SPOKE.test(l))) return [];
  return found.rows;
}

/**
 * The one key to press next to reach the answer the operator asked for — or a refusal.
 *
 * MEASURED 2026-09-01 against a live Claude Code menu: **the highlight wraps.** One Up from
 * the top row lands on the bottom row. So there is no way to press a fixed list of keys and
 * know where you finished; the earlier version of this file tried to, by pressing Up enough
 * times to "park at the top", and instead landed on row ((start + n − total − 1) mod total)
 * + 1 — a different row depending on where the highlight already was. On the trust prompt
 * that chose "No, exit" and killed the agent.
 *
 * So: one press at a time, reading the screen in between, and Enter only once the screen
 * itself says the highlight is on the wanted row. The caller turns the crank; the rule is here.
 *
 * @param {string} text - the pane's screen right now
 * @param {RegExp} wanted - matches the label of the answer to land on
 * @returns {{do:'up'|'down'|'enter'|'stop', why?:string, row?:number, label?:string}}
 */
export function nextPress(text, wanted) {
  const menu = readMenu(text);
  if (!menu.length) return { do: 'stop', why: 'There is no menu on that screen any more.' };
  if (menu.length > MAX_OPTIONS) {
    return { do: 'stop', why: `That menu has ${menu.length} choices — too many to walk with arrow keys.` };
  }
  const want = menu.find((o) => wanted.test(o.label));
  if (!want) return { do: 'stop', why: 'That answer is not one of the choices on this screen.' };
  const on = menu.find((o) => o.here)?.n ?? 0;
  if (!on) return { do: 'stop', why: 'Cannot tell which choice is highlighted, so nothing was pressed.' };
  if (on === want.n) return { do: 'enter', row: want.n, label: want.label };
  // The highlight wraps, so going up can be the short way round.
  const down = (want.n - on + menu.length) % menu.length;
  return { do: down <= menu.length - down ? 'down' : 'up', row: want.n, label: want.label };
}


/** A choice is only offerable if it is a real row of a menu short enough to walk. */
export const isChoice = (n, of) => Number.isInteger(n) && Number.isInteger(of)
  && of > 1 && of <= MAX_OPTIONS && n >= 1 && n <= of;


export function exactLabel(label) {
  const escaped = String(label ?? '').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp('^\\s*' + escaped + '\\s*$', 'i');
}
