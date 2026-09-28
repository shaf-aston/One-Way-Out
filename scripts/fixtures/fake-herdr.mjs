#!/usr/bin/env node
// A stand-in for the Herdr CLI, for driving the whole app in a browser with no real agent
// anywhere near it. Point `herdrBin` at this file (scripts/e2e.mjs does) and every call the
// app makes lands here instead: agents are rows in a JSON file, not processes.
//
// It answers the handful of commands src/herdr.mjs sends, in the same envelope Herdr uses, and
// plays a very small agent: a pane that is sent a brief goes "working" for a moment, then does
// what the brief asks — writes its result file, or, when told only to plan, writes a plan file
// handing two issues to its reports. That is enough to watch a company run end to end.
//
// State lives in $FAKE_HERDR_DIR/state.json. Every text typed into a pane is appended to
// $FAKE_HERDR_DIR/sent.log, so a test can check exactly what an agent would have been told.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dir = process.env.FAKE_HERDR_DIR || path.join(process.cwd(), '.fake-herdr');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'state.json');
const WORK_MS = Number(process.env.FAKE_HERDR_WORK_MS || 2500);

const blank = () => ({ n: 0, workspaces: [], tabs: [], panes: [] });
const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return blank(); } };
const save = (s) => writeFileSync(file, JSON.stringify(s, null, 2));
const out = (result) => { process.stdout.write(JSON.stringify({ result })); };
const fail = (message) => { process.stdout.write(JSON.stringify({ error: { message } })); };

const s = load();
const now = Date.now();
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

/** Play out whatever a pane was told, once its "work" time has passed. */
function settle(p) {
  if (!p.job || now < p.busyUntil) return;
  const job = p.job;
  p.job = null;
  p.screen.push(`✻ Done (3s · ↓ ${1 + (s.n % 5)}.2k tokens)`);
  const plan = /Your task is ONLY to plan/.test(job);
  const delegate = /write JSON to the absolute path (\S+\.delegate\.json)/.exec(job)?.[1];
  const result = /write (?:a short Markdown summary of what you did|your own summary) to (?:the absolute path )?(\S+\.md)/.exec(job)?.[1];
  const reports = [...job.matchAll(/(?:Your direct reports|The team): ([^.]*)\./g)].map((m) => m[1]).join('; ');
  const ids = [...reports.matchAll(/([a-z0-9-]+) = /g)].map((m) => m[1]);
  if (plan && delegate) {
    const mine = /You are (\S+),/.exec(job)?.[1]?.toLowerCase();
    const team = ids.filter((id) => id !== mine);
    mkdirSync(path.dirname(delegate), { recursive: true });
    writeFileSync(delegate, JSON.stringify({ issues: [
      { ref: 'a', title: 'First part', body: 'Do the first part.', assignee: team[0] ?? null, priority: 'high' },
      { ref: 'b', title: 'Second part', body: 'Then the second.', assignee: team[1] ?? team[0] ?? null, after: ['a'] },
    ] }));
  } else if (result) {
    mkdirSync(path.dirname(result), { recursive: true });
    writeFileSync(result, `# Done\n\nThe fake agent in ${p.pane_id} finished: ${job.slice(0, 80)}…\n`);
  }
}

for (const p of s.panes) settle(p);
const status = (p) => (p.job ? 'working' : p.ran ? 'done' : 'idle');
const find = (id) => s.panes.find((p) => p.pane_id === id);

const [a, b] = args;
if (a === 'api' && b === 'snapshot') {
  out({ snapshot: {
    workspaces: s.workspaces,
    tabs: s.tabs,
    panes: s.panes.map((p) => ({ pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id, cwd: p.cwd, focused: false,
      terminal_id: p.terminal_id, agent_status: status(p), agent: 'claude', name: p.label, revision: p.screen.length })),
    agents: s.panes.map((p) => ({ pane_id: p.pane_id, agent_status: status(p), cwd: p.cwd, name: p.label, agent: 'claude',
      terminal_id: p.terminal_id, agent_session: { value: p.session } })),
  } });
} else if (a === 'agent' && b === 'start') {
  s.n += 1;
  const wsId = flag('--workspace') ?? `w${s.n}`;
  if (!s.workspaces.some((w) => w.workspace_id === wsId)) s.workspaces.push({ workspace_id: wsId, label: args[2], number: s.workspaces.length + 1 });
  const tabId = flag('--tab') ?? `${wsId}:t${s.n}`;
  if (!s.tabs.some((t) => t.tab_id === tabId)) s.tabs.push({ tab_id: tabId, workspace_id: wsId, label: args[2] });
  const pane = { pane_id: `${wsId}:p${s.n}`, tab_id: tabId, workspace_id: wsId, label: args[2], cwd: flag('--cwd') ?? process.cwd(),
    terminal_id: `term_${s.n}`, session: randomUUID(), screen: ['Claude Code', '> '], job: null, busyUntil: 0, ran: false,
    argv: args.slice(args.indexOf('--') + 1) };
  s.panes.push(pane);
  out({ agent: { pane_id: pane.pane_id } });
} else if (a === 'pane' && b === 'run') {
  const p = find(args[2]);
  if (!p) fail('no such pane');
  else {
    const text = args[3] ?? '';
    appendFileSync(path.join(dir, 'sent.log'), `${new Date(now).toISOString()} ${p.pane_id} ${text}\n`);
    p.screen.push(`> [message received: ${text.length} chars]`);
    p.job = text;
    p.busyUntil = now + WORK_MS;
    p.ran = true;
    out({});
  }
} else if (a === 'agent' && b === 'read') {
  const p = find(args[2]);
  if (p) out({ read: { text: p.screen.slice(-200).join('\n') } }); else fail('no such pane');
} else if (a === 'agent' && b === 'get') {
  const p = find(args[2]);
  if (p) out({ agent: { pane_id: p.pane_id, agent_status: status(p), cwd: p.cwd } }); else fail('no such pane');
} else if (a === 'pane' && b === 'close') {
  s.panes = s.panes.filter((p) => p.pane_id !== args[2]);
  out({});
} else if (a === 'pane' && b === 'move') {
  const p = find(args[2]);
  if (!p) fail('no such pane');
  else {
    if (args.includes('--new-workspace')) {
      s.n += 1;
      const ws = `w${s.n}`;
      s.workspaces.push({ workspace_id: ws, label: flag('--label') ?? p.label, number: s.workspaces.length + 1 });
      s.tabs.push({ tab_id: `${ws}:t1`, workspace_id: ws, label: p.label });
      p.workspace_id = ws; p.tab_id = `${ws}:t1`;
    } else if (args.includes('--new-tab')) {
      s.n += 1;
      const ws = flag('--workspace') ?? p.workspace_id;
      s.tabs.push({ tab_id: `${ws}:t${s.n}`, workspace_id: ws, label: p.label });
      p.workspace_id = ws; p.tab_id = `${ws}:t${s.n}`;
    }
    // Keep the pane id: Herdr would renumber it, but nothing here may depend on that.
    out({ move_result: { pane: { pane_id: p.pane_id } } });
  }
} else if (['pane', 'agent', 'server', 'tab', 'workspace'].includes(a)) {
  out({});                            // send-keys, focus, reload-config, renames: accepted, no effect
} else {
  fail(`fake herdr does not know: ${args.join(' ')}`);
}
// Workspaces with no panes left are closed, as Herdr does.
s.workspaces = s.workspaces.filter((w) => s.panes.some((p) => p.workspace_id === w.workspace_id));
s.tabs = s.tabs.filter((t) => s.panes.some((p) => p.tab_id === t.tab_id));
save(s);
