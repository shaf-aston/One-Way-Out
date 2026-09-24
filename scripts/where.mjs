#!/usr/bin/env node
// Where everything is: every project, the apps inside it, how to run each, and what it
// deploys to. Nothing is written down anywhere - it is all read off disk each run, so it
// cannot go stale. Add a project by putting it in a projectRoots folder; that is the whole
// registration step.
//   node scripts/where.mjs          the table
//   node scripts/where.mjs --json   the same, for another script to read
//   node scripts/where.mjs logi     only projects whose name contains "logi"
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listProjects, inspectProject } from '../src/projects.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(path.join(HERE, '..', 'config.json'), 'utf8'));
const argv = process.argv.slice(2);
const filter = argv.find((a) => !a.startsWith('--'));

const found = await listProjects(cfg.projectRoots ?? []);
const wanted = filter ? found.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())) : found;
const projects = (await Promise.all(wanted.map((p) => inspectProject(p.path)))).filter((p) => p.apps.length);

if (argv.includes('--json')) {
  console.log(JSON.stringify(projects, null, 2));
  process.exit(0);
}

const C = process.stdout.isTTY ? { b: '\x1b[1m', d: '\x1b[2m', o: '\x1b[0m' } : { b: '', d: '', o: '' };
for (const p of projects) {
  console.log(`\n${C.b}${p.name}${C.o}  ${C.d}${p.path}${C.o}`);
  for (const a of p.apps) {
    const bits = [a.kind, a.run && `run: ${a.run}`, a.vercel && `vercel: ${a.vercel}`, a.branch && `branch: ${a.branch}`];
    console.log(`  ${a.rel.padEnd(28)} ${bits.filter(Boolean).join('  ·  ')}`);
  }
}
console.log('');
