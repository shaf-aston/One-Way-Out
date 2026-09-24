#!/usr/bin/env node
// One door into a run, from the terminal. A thin printer over the same HTTP endpoints #/run
// uses in the browser, so there is exactly one copy of the planning/approval/rollup rules — it
// lives in src/crew.mjs, never here. If the server is not running, this says so in one line.
//   node scripts/orch.mjs run "<goal>" [--folder <path>] [--dry] [--yes]
//   node scripts/orch.mjs tree <id>
//   node scripts/orch.mjs resume <id>
//   node scripts/orch.mjs org
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(path.join(HERE, '..', 'config.json'), 'utf8'));
const BASE = `http://127.0.0.1:${cfg.port}`;
// Same fallback server.mjs uses for an unset runsDir — only needed here to point at report.md.
const runsDir = cfg.runsDir || path.join(os.homedir(), '.claude', 'herdr', 'runs');

const C = process.stdout.isTTY
  ? { b: '\x1b[1m', d: '\x1b[2m', o: '\x1b[0m', warn: '\x1b[33m', ok: '\x1b[32m' }
  : { b: '', d: '', o: '', warn: '', ok: '' };

async function api(method, pathname, body) {
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    console.log('start it with: node server.mjs');
    process.exit(1);
  }
  const out = await res.json().catch(() => ({ ok: false, error: `bad response (${res.status})` }));
  if (!out.ok) { console.error(`${C.warn}${out.error}${C.o}`); process.exit(1); }
  return out;
}

function printPlan(plan) {
  if (!plan) { console.log(`${C.d}(no plan yet)${C.o}`); return; }
  for (const t of plan.tasks) {
    const under = t.parent ? `under ${t.parent}` : 'top of the tree';
    const after = t.after ? `, after ${t.after}` : '';
    console.log(`${C.b}${t.id}${C.o}  ${t.title}  ${C.d}[${t.model}] ${under}${after}${C.o}`);
    console.log(`  ${t.brief}`);
    if (t.lane?.length) console.log(`  ${C.d}lane: ${t.lane.join(', ')}${C.o}`);
  }
}

const TASK_STATE_TEXT = {
  working: 'working', rolling: `${C.b}rolling up${C.o}`, done: `${C.ok}done${C.o}`,
  unsure: `${C.warn}unsure — worth a look${C.o}`, failed: `${C.warn}failed to start${C.o}`,
};

function printRun(run) {
  console.log(`${C.b}${run.id}${C.o}  ${run.status}`);
  for (const [id, t] of Object.entries(run.tasks ?? {})) {
    console.log(`  ${id.padEnd(12)} ${TASK_STATE_TEXT[t.state] ?? t.state}${t.error ? ` — ${t.error}` : ''}`);
  }
  if (run.status === 'done') console.log(`${C.d}report: ${path.join(runsDir, run.id, 'report.md')}${C.o}`);
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === 'run') {
  const goal = argv.slice(1).find((a) => !a.startsWith('--'));
  if (!goal) { console.error('Usage: orch run "<goal>" [--folder <path>] [--dry] [--yes]'); process.exit(1); }
  const at = argv.indexOf('--folder');
  const folder = at >= 0 ? path.resolve(argv[at + 1]) : process.cwd();
  const dry = argv.includes('--dry');
  const yes = argv.includes('--yes');

  const { id } = await api('POST', '/api/run/plan', { goal, folder });
  console.log(`${C.d}planning… (${id})${C.o}`);

  let run;
  for (;;) {
    ({ run } = await api('GET', `/api/run/status?id=${encodeURIComponent(id)}`));
    if (run.status !== 'planning') break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (run.status === 'needs-you') {
    console.error(`${C.warn}The planner could not write a usable plan: ${run.planError}${C.o}`);
    process.exit(1);
  }

  printPlan(run.plan);
  if (dry) process.exit(0);

  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`\nStart ${run.plan.tasks.length} agent(s) for this plan? (y/N) `);
    rl.close();
    if (!/^y/i.test(ans.trim())) { console.log('Not started.'); process.exit(0); }
  }

  const { run: started } = await api('POST', '/api/run/approve', { id, plan: run.plan });
  console.log(`\n${C.ok}started${C.o}`);
  printRun(started);
  process.exit(0);
}

if (cmd === 'tree') {
  const id = argv[1];
  if (!id) { console.error('Usage: orch tree <id>'); process.exit(1); }
  const { run } = await api('GET', `/api/run/status?id=${encodeURIComponent(id)}`);
  if (run.plan) printPlan(run.plan);
  if (run.tasks) printRun(run);
  process.exit(0);
}

if (cmd === 'resume') {
  const id = argv[1];
  if (!id) { console.error('Usage: orch resume <id>'); process.exit(1); }
  const { run } = await api('POST', '/api/run/resume', { id });
  printRun(run);
  process.exit(0);
}

if (cmd === 'org') {
  // No HTTP hop needed — the fleet view already talks straight to Herdr, and reusing it here
  // beats reimplementing the same status table a second time.
  const child = spawn(process.execPath, [path.join(HERE, 'fleet.mjs')], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else if (!['run', 'tree', 'resume'].includes(cmd)) {
  console.log('Usage:\n  orch run "<goal>" [--folder <path>] [--dry] [--yes]\n  orch tree <id>\n  orch resume <id>\n  orch org');
  process.exit(cmd ? 1 : 0);
}
