// A company from a terminal — the same folder the page reads, so both always agree.
//
//   node scripts/company.mjs list                 every company, and whether it is running
//   node scripts/company.mjs state <id>           its issues and people, one line each
//   node scripts/company.mjs tick <id> --dry      what the next heartbeat WOULD do; sends nothing
//
// Nothing here starts, briefs or closes an agent: running the company is the page's Run switch,
// or the server's own heartbeat. `tick --dry` asks Herdr what is running and prints the decision.
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listCompanies, loadState } from '../src/companies.mjs';
import { createOffice } from '../src/office.mjs';
import { resolveHerdrBin } from '../src/herdr.mjs';
import { issueKey, STATUSES } from '../src/issues.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(process.env.ONE_WAY_OUT_CONFIG || path.join(root, 'config.json'), 'utf8'));
const dir = config.companiesDir || path.join(os.homedir(), '.claude', 'herdr', 'companies');
const [cmd, id] = process.argv.slice(2);

if (cmd === 'list' || !cmd) {
  const all = await listCompanies(dir);
  if (!all.length) console.log(`No companies in ${dir}. Start one from the page.`);
  for (const c of all) console.log(`${c.running ? '▶' : '⏸'} ${c.id.padEnd(24)} ${c.name} — ${c.folder}`);
} else if (cmd === 'state' && id) {
  const s = await loadState(dir, id);
  if (!s) { console.error(`No company "${id}".`); process.exit(1); }
  console.log(`${s.company.name}${s.company.running ? ' (running)' : ' (paused)'} — ${s.company.mission || 'no mission'}\n`);
  for (const e of s.employees) console.log(`  ${e.state.padEnd(12)} ${e.name} — ${e.title}${e.reportsTo ? `, reports to ${e.reportsTo}` : ''}`);
  console.log('');
  for (const st of STATUSES) {
    const list = s.issues.filter((i) => i.status === st.id);
    if (list.length) console.log(`${st.label}:\n${list.map((i) => `  ${issueKey(s.company, i).padEnd(9)} ${i.title}${i.assignee ? `  [${i.assignee}]` : ''}`).join('\n')}`);
  }
} else if (cmd === 'tick' && id && process.argv.includes('--dry')) {
  const office = createOffice({ bin: resolveHerdrBin(config.herdrBin), root: dir, limits: config.heartbeat ?? {}, agentCommand: config.defaultAgentCommand });
  const d = await office.tick(id, { dry: true, force: true });
  if (!d) { console.error('Herdr is not answering, so nothing can be decided.'); process.exit(1); }
  for (const l of d.log) console.log(`• ${l.detail}`);
  for (const e of d.effects) console.log(`→ ${e.type} ${e.employeeId}${e.issueId ? ` ${e.issueId}` : ''}${e.spawn ? ' (starts a new agent)' : ''}`);
  if (!d.log.length && !d.effects.length) console.log('Nothing would happen.');
} else {
  console.log('Usage: node scripts/company.mjs list | state <id> | tick <id> --dry');
}
