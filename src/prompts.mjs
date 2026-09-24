// Pure core: which of the questions in config.json an agent is sitting on right now.
//
// Nothing here knows about any particular prompt. The prompts come from config.json, and
// the option numbers come from each agent's own screen — so two agents showing the same
// question with a different number of options are both answered correctly, and a prompt
// whose wording changes is fixed by editing config, not this file.
//
// The shape of a menu itself is not described here — public/menu.js owns that, because the
// browser needs the very same grammar to draw the rows as buttons.
import { readMenu, isChoice } from '../public/menu.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Turn the prompts written in config.json into matchers, refusing anything malformed.
 * A typo in config must be said out loud at startup, never silently drop the button that
 * answers every agent at once.
 * @returns {{prompts:Array, errors:string[]}}
 */
export function compilePrompts(raw) {
  const prompts = [];
  const errors = [];
  for (const [i, p] of (Array.isArray(raw) ? raw : []).entries()) {
    const where = `prompts.known[${i}]`;
    const id = str(p?.id);
    const title = str(p?.title);
    const match = str(p?.match);
    const rawChoices = Array.isArray(p?.choices) ? p.choices : [];
    if (!id || !title || !match) { errors.push(`${where}: needs id, title and match`); continue; }
    if (!rawChoices.length) { errors.push(`${where}: needs at least one choice`); continue; }
    if (prompts.some((q) => q.id === id)) { errors.push(`${where}: duplicate id "${id}"`); continue; }
    let re;
    try { re = new RegExp(match, 'i'); } catch (e) { errors.push(`${where}.match: ${e.message}`); continue; }
    const choices = [];
    let bad = false;
    for (const [k, c] of rawChoices.entries()) {
      const cid = str(c?.id);
      const label = str(c?.label);
      const cm = str(c?.match);
      if (!cid || !label || !cm) { errors.push(`${where}.choices[${k}]: needs id, label and match`); bad = true; break; }
      if (choices.some((q) => q.id === cid)) { errors.push(`${where}.choices[${k}]: duplicate id "${cid}"`); bad = true; break; }
      try { choices.push({ id: cid, label, re: new RegExp(cm, 'i') }); }
      catch (e) { errors.push(`${where}.choices[${k}].match: ${e.message}`); bad = true; break; }
    }
    if (!bad) prompts.push({ id, title, re, choices });
  }
  return { prompts, errors };
}

/**
 * Which known prompt this screen is showing, with each answer's position in THIS menu.
 * @param {string} text - the pane's screen as plain text
 * @param {Array} prompts - from compilePrompts
 * @returns {{id:string,title:string,choices:Array<{id,label,n,total}>}|null}
 */
export function matchPrompt(text, prompts = []) {
  const menu = readMenu(text);
  if (!menu.length) return null;
  const screen = String(text ?? '');
  for (const p of prompts) {
    if (!p.re.test(screen)) continue;
    const choices = [];
    for (const c of p.choices) {
      const row = menu.find((o) => c.re.test(o.label));
      if (row && isChoice(row.n, menu.length)) {
        // `match` travels with the choice: the walk re-reads the screen between presses and
        // finds the row again by its words, since its number can move under us.
        choices.push({ id: c.id, label: c.label, n: row.n, total: menu.length, match: c.re.source });
      }
    }
    if (choices.length) return { id: p.id, title: p.title, choices };
  }
  return null;
}

/**
 * Agent panes worth reading for a prompt. An agent that is working cannot be sitting on a
 * question, so the statuses to skip are config, and the cap stops a big map turning one
 * poll into dozens of reads.
 * @returns {Array<{id:string,label:string,workspace:string}>}
 */
export function panesToScan(model, skipStatuses = [], max = 24) {
  const skip = new Set(skipStatuses);
  const out = [];
  for (const w of model?.workspaces ?? []) {
    for (const t of w.tabs ?? []) {
      for (const p of t.panes ?? []) {
        if (!p.isAgent || skip.has(p.status)) continue;
        out.push({ id: p.id, label: p.label, workspace: w.label });
      }
    }
  }
  return out.slice(0, Math.max(0, max));
}

/**
 * One row per question, however many agents are stuck on it — because the whole point is
 * answering them together. Each choice carries how many agents it would answer.
 */
export function groupWaiting(entries) {
  const byPrompt = new Map();
  for (const e of entries) {
    let g = byPrompt.get(e.prompt.id);
    if (!g) byPrompt.set(e.prompt.id, g = { id: e.prompt.id, title: e.prompt.title, choices: new Map(), agents: [] });
    g.agents.push({ paneId: e.id, label: e.label, workspace: e.workspace });
    for (const c of e.prompt.choices) {
      const seen = g.choices.get(c.id) ?? { id: c.id, label: c.label, count: 0 };
      seen.count += 1;
      g.choices.set(c.id, seen);
    }
  }
  return [...byPrompt.values()].map((g) => ({ ...g, choices: [...g.choices.values()] }));
}

/**
 * A menu label matched as itself. The words come off the agent's own screen and go straight
 * into a pattern, so every character in them is escaped first — a label containing "(recommended)"
 * must match that text, not a regex group.
 * @param {string} label
 * @returns {RegExp}
 */
