// The folders you can start an agent in: every immediate subfolder of your project roots,
// plus wherever agents are already running. Read-only — it lists, it never creates.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const HIDDEN = /^[._]|^node_modules$/;

/**
 * @param {string[]} roots - folders from config that hold projects
 * @param {string[]} inUse - cwds of agents already running, so they sort to the top
 * @returns {Promise<Array<{path:string, name:string, running:boolean}>>}
 */
export async function listProjects(roots, inUse = []) {
  const seen = new Map();
  const add = (p, running) => {
    const full = path.normalize(p);
    if (!seen.has(full)) seen.set(full, { path: full, name: path.basename(full), running });
    else if (running) seen.get(full).running = true;
  };

  for (const cwd of inUse) if (cwd) add(cwd, true);

  for (const root of roots) {
    let entries = [];
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && !HIDDEN.test(e.name)) add(path.join(root, e.name), false);
  }

  return [...seen.values()].sort((a, b) =>
    (b.running - a.running) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
