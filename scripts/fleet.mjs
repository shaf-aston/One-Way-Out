#!/usr/bin/env node
// One clean terminal view of every Herdr agent, grouped by the folder they work in.
// Agents sharing a folder are a team whether or not anyone said so, so the grouping IS the link.
//   node scripts/fleet.mjs           see the fleet
//   node scripts/fleet.mjs --names   spaces = the folder (numbered); chat name on the line below
//   node scripts/fleet.mjs --names --watch 5   keep doing that every 5s, so new spaces self-number
//   node scripts/fleet.mjs --link    draft the "you share this folder" note for each team
//   node scripts/fleet.mjs --link --send   actually type those notes into the panes
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveHerdrBin, getSnapshot, runInPane, renameWorkspace, renameAgent, renameTab } from '../src/herdr.mjs';
import { buildModel } from '../src/model.mjs';
import { labelPlan } from '../src/labels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', off: '\x1b[0m', bold: '\x1b[1m', ok: '\x1b[32m', warn: '\x1b[33m', busy: '\x1b[36m', mute: '\x1b[90m' }
  : { dim: '', off: '', bold: '', ok: '', warn: '', busy: '', mute: '' };

const DOT = { working: `${C.busy}●${C.off}`, blocked: `${C.warn}●${C.off}`, done: `${C.ok}●${C.off}`, idle: `${C.mute}○${C.off}`, unknown: `${C.mute}·${C.off}` };

/** Flatten the model to agents, keeping the status the dots need. */
const agentsOf = (model) => (model.workspaces ?? [])
  .flatMap((w) => w.tabs.flatMap((t) => t.panes.filter((p) => p.isAgent)
    .map((p) => ({ id: p.id, label: p.label, status: p.status, cwd: p.cwd || '(no folder)',
      ws: w.id, tab: t.id, wsLabel: w.label, chat: p.title ?? p.label }))));

/** Group by folder — insertion-ordered, so the print order is stable. */
function byFolder(agents) {
  const teams = new Map();
  for (const a of agents) {
    if (!teams.has(a.cwd)) teams.set(a.cwd, []);
    teams.get(a.cwd).push(a);
  }
  return [...teams.entries()].map(([cwd, members]) => ({ cwd, members }));
}

/** First line of an error - Herdr failures are multi-line; only the first says what broke. */
const first = (e) => String(e.message || e).trim().split(/[\r\n]/)[0];
const pad = (s, n) => (s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length));

function render(teams, counts) {
  const tally = ['working', 'blocked', 'done', 'idle']
    .filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · ');
  const out = [`\n${C.bold}HERDR FLEET${C.off}  ${C.dim}${counts.total} agents · ${tally}${C.off}\n`];
  for (const { cwd, members } of teams) {
    const linked = members.length > 1 ? `${C.warn}linked${C.off}` : `${C.dim}solo${C.off}`;
    out.push(`${C.bold}${path.basename(cwd)}${C.off}  ${C.dim}${members.length} · ${C.off}${linked}`);
    out.push(`${C.dim}${cwd}${C.off}`);
    for (const m of members) {
      out.push(`  ${DOT[m.status] ?? DOT.unknown} ${pad(m.id, 8)} ${pad(m.label, 52)} ${C.dim}${m.status}${C.off}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** The note a folder-mate needs: who else is here, and that it is expected. */
function brief(team, me) {
  const others = team.members.filter((m) => m.id !== me.id)
    .map((m) => `${m.id} (${m.label})`).join(', ');
  return `Heads up: you are not alone in ${team.cwd}. Other Claude agents working this same folder right now: ${others}. `
    + `This is expected and coordinated - do not stop to ask who is editing. `
    + `Stay in your own lane, keep to your own files and branch, and before touching shared ground check with them: `
    + `herdr pane run <pane_id> "<message>" to speak, herdr agent read <pane_id> --source recent-unwrapped --lines 200 --format text to hear back.`;
}

const cfg = JSON.parse(await readFile(path.join(HERE, '..', 'config.json'), 'utf8')).herdrBin;
const bin = resolveHerdrBin(cfg);
const snap = await getSnapshot(bin);
if (!snap.ok) { console.error(`${C.warn}${snap.error}${C.off}`); process.exit(1); }

const model = buildModel(snap.snapshot);
const teams = byFolder(agentsOf(model));
const argv = process.argv.slice(2);
const wantsLink = argv.includes('--link');
const wantsSend = argv.includes('--send');

console.log(render(teams, model.counts));

if (argv.includes('--names')) {
  // What everything should be called is decided in src/labels.mjs (pure); this only applies it.
  const apply = async (shot) => {
    // Every pane, not just agent ones: a space holding a plain shell still needs its number,
    // or the next agent opened in that folder lands on a name already taken.
    const was = new Map((shot.workspaces ?? []).map((w) => [w.workspace_id, w.label]));
    const rows = (shot.panes ?? []).map((p) => ({
      id: p.pane_id, ws: p.workspace_id, tab: p.tab_id, cwd: p.cwd || '',
      chat: (p.terminal_title_stripped || '').replace(/^[^\w]+\s*/, '') || null,
      typed: p.label ?? null,
      wsLabel: was.get(p.workspace_id) ?? '',   // a space you named yourself is left alone
    }));
    const plan = labelPlan(rows);
    for (const sp of plan.spaces) {
      if (sp.label === was.get(sp.ws)) continue;
      try { await renameWorkspace(bin, sp.ws, sp.label); console.log(`${C.ok}space${C.off} ${sp.ws}  ${sp.label}`); }
      catch (e) { console.log(`${C.warn}space failed${C.off} ${sp.ws} — ${first(e)}`); }
    }
    // Park first: agent names must be unique, so renaming A to a name B still holds would fail.
    for (const ag of plan.agents) { try { await renameAgent(bin, ag.pane, `pane ${ag.pane}`); } catch {} }
    for (const ag of plan.agents) {
      try { await renameAgent(bin, ag.pane, ag.name); }
      catch (e) { console.log(`${C.warn}agent failed${C.off} ${ag.pane} — ${first(e)}`); }
    }
    for (const tb of plan.tabs) { try { await renameTab(bin, tb, ''); } catch {} }
  };

  // --watch keeps applying, so a space opened later is numbered without anyone re-running this.
  const at = argv.indexOf('--watch');
  const every = at < 0 ? 0 : Math.max(2, Number(argv[at + 1]) || 5) * 1000;
  await apply(snap.snapshot);
  if (every) {
    console.log(`${C.dim}watching every ${every / 1000}s — ctrl+c to stop${C.off}`);
    for (;;) {
      await new Promise((r) => setTimeout(r, every));
      const next = await getSnapshot(bin);
      if (next.ok) await apply(next.snapshot);
    }
  }
  console.log('');
}

if (!wantsLink) process.exit(0);

const shared = teams.filter((t) => t.members.length > 1);
if (!shared.length) { console.log(`${C.dim}No folder has more than one agent — nothing to link.${C.off}\n`); process.exit(0); }

for (const team of shared) {
  console.log(`${C.bold}${path.basename(team.cwd)}${C.off}`);
  for (const me of team.members) {
    console.log(`  ${C.dim}→ ${me.id}${C.off}  ${brief(team, me).slice(0, 140)}…`);
  }
  console.log('');
}

if (!wantsSend) {
  console.log(`${C.warn}Draft only.${C.off} Re-run with ${C.bold}--link --send${C.off} to type these into the panes.\n`);
  process.exit(0);
}

// Herdr tells a pane its own id. Without this the pane running the script briefs itself.
const SELF = process.env.HERDR_PANE_ID || '';

for (const team of shared) {
  for (const me of team.members) {
    if (me.id === SELF) { console.log(`${C.dim}skip${C.off} ${me.id} (this pane)`); continue; }
    try {
      await runInPane(bin, me.id, brief(team, me));
      console.log(`${C.ok}sent${C.off} ${me.id}`);
    } catch (e) {
      console.log(`${C.warn}failed${C.off} ${me.id} — ${String(e.message || e).split('\n')[0]}`);
    }
  }
}
console.log('');
