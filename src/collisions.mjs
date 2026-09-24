// Pure core: which folders have more than one agent working in them. No I/O, no clock, no UI.
// The map groups cards by Herdr WINDOW, so agents sharing one working folder are drawn in
// separate boxes and nothing on screen says they are on the same files. This is the only place
// that notices. It reports the fact; moving an agent is the operator's call, never this file's.
import path from 'node:path';
import { listAgents } from './model.mjs';

/**
 * Windows names one folder several ways — "C:\x\y", "c:\x\y\" and "C:/x/y" are the same place —
 * so grouping on the raw string would miss the very thing being looked for. This key only ever
 * groups; the path handed back is the one Herdr actually said.
 */
function folderKey(dir) {
  const norm = path.normalize(dir).replace(/(.)[\\/]+$/, '$1');
  // Case is folded only for a Windows-shaped path. Elsewhere two folders differing in case
  // really are two folders, and merging them would invent a clash that is not there.
  return /^[a-z]:[\\/]/i.test(norm) ? norm.toLowerCase() : norm;
}

/**
 * Every folder holding more agents than the allowed number, busiest first.
 * @param {object} model - the value from buildModel
 * @param {number} [maxPerFolder=1] - how many agents may share one folder before it is worth
 *   saying so; 1 means two agents in one folder already counts.
 * @returns {Array<{folder:string, path:string, agents:Array<{id:string,label:string,workspace:string}>}>}
 *   `folder` is the short name a sentence can use, `path` the whole thing. Empty when nothing
 *   is shared.
 */
export function sharedFolders(model, maxPerFolder = 1) {
  const cap = Number.isFinite(maxPerFolder) && maxPerFolder > 0 ? Math.floor(maxPerFolder) : 1;
  const byFolder = new Map();

  for (const a of listAgents(model)) {
    // An agent Herdr reports no folder for cannot be shown to be sharing one.
    const dir = String(a.cwd ?? '').trim();
    if (!dir) continue;
    const key = folderKey(dir);
    let group = byFolder.get(key);
    if (!group) byFolder.set(key, group = { folder: path.basename(dir) || dir, path: dir, agents: [] });
    group.agents.push({ id: a.id, label: a.label, workspace: a.workspace });
  }

  return [...byFolder.values()]
    .filter((g) => g.agents.length > cap)
    .sort((a, b) => b.agents.length - a.agents.length || a.folder.localeCompare(b.folder));
}
