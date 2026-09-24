// Swap-seam: the ONLY module that reads Claude Code's own command/skill folders.
// Nothing is hardcoded — whatever exists on disk is what the palette offers, so a new
// command or skill shows up here the moment it exists, with no change to this project.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const MAX_ENTRIES = 300;     // cap: never let a huge folder stall the UI
const MAX_BYTES = 64 * 1024; // cap: only the head of a file is needed for its description

/** Pull `description:` out of YAML front matter, including folded (`>-`) blocks. */
export function describe(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (fm) {
    const lines = fm[1].split(/\r?\n/);
    const i = lines.findIndex((l) => /^description:/.test(l));
    if (i !== -1) {
      let value = lines[i].replace(/^description:\s*/, '').trim();
      if (/^[>|][-+]?$/.test(value)) {
        const block = [];
        for (const line of lines.slice(i + 1)) {
          if (!/^\s+\S/.test(line)) break; // dedented line = the next key, so the block ends
          block.push(line.trim());
        }
        value = block.join(' ');
      }
      return value.replace(/^["']|["']$/g, '').trim().slice(0, 160);
    }
  }
  const body = (text || '').replace(/^---[\s\S]*?\r?\n---/, '');
  const line = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
  return (line || '').replace(/[*_`]/g, '').trim().slice(0, 160);
}

async function head(file) {
  try {
    const buf = await readFile(file);
    return buf.slice(0, MAX_BYTES).toString('utf8');
  } catch { return ''; }
}

async function listDir(dir) {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
}

/** Markdown files in a commands folder -> /name entries. */
async function fromCommands(dir, source) {
  const out = [];
  for (const e of await listDir(dir)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    out.push({ name: `/${name}`, kind: 'command', source, desc: describe(await head(path.join(dir, e.name))) });
  }
  return out;
}

/** Skill folders holding a SKILL.md -> /name entries. */
async function fromSkills(dir, source) {
  const out = [];
  for (const e of await listDir(dir)) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    try { await stat(file); } catch { continue; }
    out.push({ name: `/${e.name}`, kind: 'skill', source, desc: describe(await head(file)) });
  }
  return out;
}

/** True when `cwd` is a usable absolute directory path (trust boundary for the ?cwd= param). */
async function isUsableDir(cwd) {
  if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd) || cwd.includes('\0')) return false;
  try { return (await stat(cwd)).isDirectory(); } catch { return false; }
}

/**
 * Every slash command and skill this machine can run, optionally including the
 * project-local ones for a pane's working directory.
 * @param {string|null} cwd - the agent pane's cwd, or null for global only.
 */
export async function listCommands(cwd) {
  const home = path.join(os.homedir(), '.claude');
  const groups = [
    await fromCommands(path.join(home, 'commands'), 'global'),
    await fromSkills(path.join(home, 'skills'), 'skill'),
  ];
  if (await isUsableDir(cwd)) {
    groups.push(await fromCommands(path.join(cwd, '.claude', 'commands'), 'project'));
  }
  // Project entries win over global ones of the same name, matching Claude Code's own precedence.
  const byName = new Map();
  for (const item of groups.flat()) {
    if (item.source === 'project' || !byName.has(item.name)) byName.set(item.name, item);
  }
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES);
}
