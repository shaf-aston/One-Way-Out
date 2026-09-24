// The folders you can start an agent in: every immediate subfolder of your project roots,
// plus wherever agents are already running. Read-only — it lists, it never creates.
import { readdir, readFile } from 'node:fs/promises';
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


/** How deep inside a project folder an app can hide before we stop looking. */
const APP_DEPTH = 3;

const readJson = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

/** Every folder inside a project that is worth inspecting, nearest first. */
async function appFolders(dir, depth = APP_DEPTH) {
  const out = [dir];
  if (depth <= 0) return out;
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || HIDDEN.test(e.name) || e.name === 'venv') continue;
    out.push(...await appFolders(path.join(dir, e.name), depth - 1));
  }
  return out;
}

/**
 * The command that actually starts a python service, worked out from the code: find the file
 * that builds the app object, turn its path into the module name uvicorn wants, and take the
 * port from the project's own .env if it names one. Nothing about any project is assumed.
 */
async function pythonRun(dir) {
  for (const folder of await appFolders(dir, 2)) {
    let entries = [];
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.py')) continue;
      const src = await readFile(path.join(folder, e.name), 'utf8').catch(() => '');
      const app = /^\s*(\w+)\s*=\s*(FastAPI|Flask)\s*\(/m.exec(src);
      if (!app) continue;
      const mod = [...path.relative(dir, folder).split(path.sep), e.name.replace(/\.py$/, '')]
        .filter(Boolean).join('.');
      const env = await readFile(path.join(dir, '.env'), 'utf8').catch(() => '');
      const port = /^PORT\s*=\s*(\d+)/m.exec(env)?.[1];
      return `python -m uvicorn ${mod}:${app[1]}${port ? ` --port ${port}` : ''}`;
    }
  }
  return null;
}

/** The branch, straight out of .git/HEAD - no git process, so this stays fast. */
async function branchOf(dir) {
  const head = await readFile(path.join(dir, '.git', 'HEAD'), 'utf8').catch(() => null);
  if (!head) return null;
  return head.startsWith('ref:') ? head.trim().split('/').slice(2).join('/') : head.trim().slice(0, 7);
}

/**
 * What a project is and how to run it - all read off disk, nothing remembered here.
 * @param {string} dir - a project folder from listProjects
 * @returns {Promise<{path:string, name:string, apps:Array<object>}>}
 */
export async function inspectProject(dir) {
  const apps = [];
  for (const folder of await appFolders(dir)) {
    const pkg = await readJson(path.join(folder, 'package.json'));
    const vercel = await readJson(path.join(folder, '.vercel', 'project.json'));
    const reqs = await readFile(path.join(folder, 'requirements.txt'), 'utf8').catch(() => null);
    const py = reqs && /fastapi|flask|uvicorn/i.test(reqs) ? 'python api' : reqs ? 'python' : null;
    const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
    const kind = pkg?.dependencies?.next ? 'next' : deps.vite ? 'vite' : pkg ? 'node' : py;
    if (!kind) continue;
    apps.push({
      path: folder,
      rel: path.relative(dir, folder) || '.',
      kind,
      scripts: pkg ? Object.keys(pkg.scripts ?? {}) : [],
      run: pkg?.scripts?.dev ? 'npm run dev' : py === 'python api' ? await pythonRun(folder) : null,
      vercel: vercel?.projectName ?? null,
      branch: await branchOf(folder),
    });
  }
  return { path: dir, name: path.basename(dir), apps };
}
