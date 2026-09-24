// Pure core: decide every sidebar label in one place. No I/O - callers apply the plan.
//
// Herdr's sidebar, as measured (scripts/shot.ps1, 2026-08-20):
//   spaces list  - ONE line per space. A newline in the label is stripped, not wrapped
//                  ("puff\nClaude Code" renders as "puffClaude Code"), so only one fact fits.
//   agents panel - TWO lines: bold echoes the space label, faint is the agent name.
//                  This is the only place a second line can sit under the first.
//   tab label    - emptied, or Herdr glues it onto the bold line horizontally.
// So: folder -> space label (and therefore the bold line), chat name -> the faint line below it.
// Every space is numbered, even a pane still sitting at a shell prompt - skipping one would let
// the next pane opened in that folder land on a name already taken.
import path from 'node:path';

/** Longest label the sidebar shows before Herdr's own ellipsis makes names ambiguous. */
const WIDE = 34;

/** What a pane calls itself before the chat has a subject of its own. */
const BANNER = /^(claude( code)?|codex|terminal|shell|pwsh|powershell|bash)$/i;

/**
 * Is this the agent program's own name rather than something the operator chose? Herdr adds
 * " (2)" to a repeat, so that is trimmed before asking.
 * @param {string|null} name
 * @returns {boolean}
 */
export const isBanner = (name) => BANNER.test(String(name ?? '').replace(/\s*\(\d+\)$/, '').trim());

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Is this space label something a script produced, rather than something a person chose?
 * Blank, Herdr's own "Workspace 3", or the folder name (with or without the " (2)" this file
 * adds) all count as generated. Anything else is a name he typed, and is left alone.
 */
export function generatedLabel(current, folder) {
  const v = (current ?? '').trim();
  if (!v) return true;
  if (/^workspace\s*\d*$/i.test(v)) return true;
  const base = v.replace(/\s*\(\d+\)$/, '').replace(/…$/, '');
  return base === folder || (base.length > 1 && folder.startsWith(base));
}

/** Second and later uses of a name get a counter - Herdr needs every label unique. */
const uniq = () => {
  const seen = new Map();
  return (name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return cut(n === 1 ? name : `${name} (${n})`, WIDE);
  };
};

/**
 * Decide what every space, agent and tab should be called.
 * @param {Array<{id:string, ws:string, tab:string, cwd:string, chat:string|null, typed:string|null,
 *   wsLabel?:string}>} agents
 *   one entry per agent pane: `typed` is a label a person set on the pane, `chat` the title
 *   the chat gave itself, `wsLabel` what the space is called in the sidebar right now.
 * @returns {{spaces:Array<{ws:string,label:string}>, agents:Array<{pane:string,name:string}>, tabs:string[]}}
 *   tabs lists tab ids whose label must be cleared to ''.
 */
export function labelPlan(agents) {
  const folderOf = (a) => path.basename(a.cwd || '') || '(no folder)';
  const spaceName = uniq();
  const agentName = uniq();
  const spaces = [];
  const agentNames = [];
  const seenWs = new Set();

  for (const a of agents) {
    const folder = folderOf(a);
    // A label that merely echoes the folder is residue of a rename, not a chosen name,
    // and a path means the pane is still a bare shell prompt.
    const real = (v) => (v && !BANNER.test(v) && v !== folder
      && !v.startsWith(folder + ' ') && !/[\/]/.test(v) ? v : null);
    // No real name means a bare shell prompt: it still gets a numbered space, but no chat line.
    const name = real(a.typed) || real(a.chat);
    if (name) agentNames.push({ pane: a.id, name: agentName(name) });
    if (seenWs.has(a.ws)) continue;
    seenWs.add(a.ws);
    // The counter advances for every space, so two spaces never end up with one name — but a
    // space you named yourself keeps that name. Only a blank one, or one still carrying the
    // folder name this script gave it, is written over.
    const proposed = spaceName(folder);
    if (generatedLabel(a.wsLabel, folder)) spaces.push({ ws: a.ws, label: proposed });
  }

  return { spaces, agents: agentNames, tabs: [...new Set(agents.map((a) => a.tab))] };
}
