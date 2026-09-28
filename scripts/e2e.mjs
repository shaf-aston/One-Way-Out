// The whole app, driven in a real browser, against a FAKE Herdr — no real agent is ever touched.
//
//   node scripts/e2e.mjs            (needs Playwright installed globally: npm i -g playwright)
//   node scripts/e2e.mjs --shots <dir>   also keep a screenshot of every page
//
// It starts its own server on a scratch config: companies in a temp folder, Herdr replaced by
// scripts/fixtures/fake-herdr.mjs, Herdr's config.toml a scratch copy. Then it founds a company,
// plans a goal, runs the company until the fake agents finish the work, and walks every page.
// A request guard fails the run if the page ever calls a route that types into, keys, or
// closes an agent directly — those are for a person, never a test.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
const { chromium } = require('playwright');

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), 'owo-e2e-'));
const PORT = 4800 + Math.floor(Math.random() * 100);
const fake = path.join(here, 'fixtures', 'fake-herdr.mjs');
mkdirSync(path.join(tmp, 'proj'));
writeFileSync(path.join(tmp, 'herdr.toml'), '[ui]\nconfirm_close = true\n');
const config = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));
Object.assign(config, { port: PORT, openBrowser: false, herdrBin: fake, herdrConfigPath: path.join(tmp, 'herdr.toml'),
  companiesDir: path.join(tmp, 'companies'), shotsDir: path.join(tmp, 'shots'), projectRoots: [tmp] });
Object.assign(config.heartbeat, { tickMs: 1000, graceMs: 8000, deliverWaitMs: 100 });
writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(config));

const server = spawn(process.execPath, [path.join(root, 'server.mjs')], {
  env: { ...process.env, ONE_WAY_OUT_CONFIG: path.join(tmp, 'config.json'), FAKE_HERDR_DIR: path.join(tmp, 'herdr'), FAKE_HERDR_WORK_MS: '1500' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !log.includes('running at'); i += 1) await new Promise((r) => setTimeout(r, 100));
assert.ok(log.includes(`Using Herdr at: ${fake}`), 'the server must be on the fake Herdr before anything is clicked');

// Routes that reach an agent directly, not through the company. Matched on the exact path.
const LIVE = new Set(['/api/pane/send', '/api/pane/keys', '/api/agents/close-all', '/api/prompts/answer']);
const base = `http://localhost:${PORT}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const problems = [];
page.on('request', (r) => { const u = new URL(r.url()); if (r.method() === 'POST' && LIVE.has(u.pathname)) problems.push(`live route called: ${u.pathname}`); });
page.on('pageerror', (e) => problems.push(`page error: ${e.stack}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
const shot = async (name) => { if (shotsAt) await page.screenshot({ path: path.join(shotsAt, `${name}.png`), fullPage: true }); };
const api = async (p) => (await (await fetch(base + p)).json());
const state = async () => api(`/api/c/${(await api('/api/companies')).companies[0].id}/state`);
const until = async (what, test, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    const s = await state();
    if (test(s)) return s;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${JSON.stringify(s.issues.map((i) => [i.title, i.status]))}\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
};

try {
  // ── Found a company ──
  await page.goto(base);
  await page.getByRole('heading', { name: 'Start a company' }).waitFor();
  await shot('01-setup');
  await page.fill('.setup-form [name=name]', 'Acme');
  await page.fill('.setup-form [name=mission]', 'Ship the simplest invoicing app');
  await page.fill('.setup-form [name=folder]', path.join(tmp, 'proj'));
  await page.click('.setup-form button[type=submit]');
  await page.locator('.page-head h2', { hasText: 'Acme' }).waitFor();
  assert.equal(await page.locator('.emps .emp').count(), 3, 'the "CEO + 2 engineers" template hires three');
  assert.ok(await page.locator('.banner', { hasText: 'Paused' }).isVisible(), 'a new company starts paused');
  await shot('02-dashboard-new');

  // ── A goal, planned by the CEO ──
  await page.keyboard.press('g');
  await page.locator('.page-head h2', { hasText: 'Goals' }).waitFor();
  await page.click('[data-act="new"]');
  await page.fill('.dialog [name=title]', 'Launch v1');
  await page.fill('.dialog [name=detail]', 'Invoices can be created and sent.');
  await page.click('.dialog [data-act="save"]');
  await page.locator('.goal-title', { hasText: 'Launch v1' }).waitFor();
  await page.click('[data-act="plan"]');
  await page.locator('.goal .tag', { hasText: 'being planned' }).waitFor();
  await shot('03-goals');

  // ── Run: the CEO plans, the plan comes to the Inbox ──
  await page.click('#run-toggle');
  await page.locator('#run-toggle.on').waitFor();
  await until('a plan in the Inbox', (s) => s.approvals.some((a) => a.state === 'pending' && a.kind === 'plan'));
  await page.keyboard.press('b');
  await page.locator('.approval h3', { hasText: 'Plan' }).waitFor();
  assert.ok(await page.locator('#inbox-count').isVisible(), 'the nav counts what is waiting');
  await shot('04-inbox');
  await page.click('[data-decide="approve"]');
  await page.locator('.state', { hasText: 'Nothing is waiting' }).waitFor();

  // ── The team does the work, in order ──
  const s1 = await until('both parts done', (s) => ['First part', 'Second part'].every((t) => s.issues.find((i) => i.title === t)?.status === 'done'), 45000);
  const first = s1.issues.find((i) => i.title === 'First part');
  const second = s1.issues.find((i) => i.title === 'Second part');
  assert.deepEqual(second.blockedBy, [first.id], 'the plan\'s order became a real dependency');
  assert.ok(second.work.startedAt >= first.work.finishedAt, 'the second part did not start before the first was done');
  assert.equal(s1.employees.find((e) => e.id === 'ada').usage.tasks, 1, 'finished work counts toward the budget');

  // ── Issues board: quick add, assign from the detail page, comment ──
  await page.keyboard.press('i');
  await page.locator('.kanban').waitFor();
  await page.fill('[data-quick] [name=title]', 'Write the docs');
  await page.press('[data-quick] [name=title]', 'Enter');
  await page.locator('.kcol.k-backlog .issue', { hasText: 'Write the docs' }).waitFor();
  await shot('05-issues');
  await page.click('.kcol.k-backlog .issue:has-text("Write the docs")');
  await page.locator('.issue-head h2', { hasText: 'Write the docs' }).waitFor();
  await page.selectOption('[data-field="assignee"]', 'linus');
  await until('the docs to be done', (s) => s.issues.find((i) => i.title === 'Write the docs')?.status === 'done');
  await page.fill('[data-comment] textarea', 'Looks good.');
  await page.click('[data-comment] button');
  await page.locator('.thread li', { hasText: 'Looks good.' }).waitFor();
  await page.locator('pre.result').waitFor();
  await shot('06-issue');

  // ── Org: budget caps pause, and ask ──
  await page.keyboard.press('o');
  await page.locator('.org-row').first().waitFor();
  await page.click('[data-emp="ada"] [data-emp-act="edit"]');
  await page.fill('.dialog [name=tasksPerDay]', '1');
  await page.click('.dialog [data-act="save"]');
  await until('ada to be over budget', (s) => s.employees.find((e) => e.id === 'ada').state === 'over-budget');
  await page.keyboard.press('b');
  await page.locator('.approval h3', { hasText: 'Budget' }).waitFor();
  await page.click('[data-decide="approve"]');
  const s2 = await until('ada to be back', (s) => s.employees.find((e) => e.id === 'ada').state === 'active');
  assert.equal(s2.employees.find((e) => e.id === 'ada').budget.tasksPerDay, 2);
  await page.keyboard.press('o');
  await page.click('[data-emp="linus"] [data-emp-act="pause"]');
  await until('linus paused', (s) => s.employees.find((e) => e.id === 'linus').state === 'paused');
  await page.click('[data-emp="linus"] [data-emp-act="resume"]');
  await until('linus resumed', (s) => s.employees.find((e) => e.id === 'linus').state === 'active');
  await shot('07-org');

  // ── Routines ──
  await page.keyboard.press('r');
  await page.click('[data-act="new"]');
  await page.fill('.dialog [name=title]', 'Nightly check');
  await page.selectOption('.dialog [name=assignee]', 'ada');
  await page.click('.dialog [data-act="save"]');
  await page.locator('td', { hasText: 'daily at 09:00' }).waitFor();
  await shot('08-routines');

  // ── Activity, Dashboard, Agents, Settings, Help ──
  await page.keyboard.press('l');
  await page.locator('[data-log] li', { hasText: 'Plan approved' }).waitFor();
  await shot('09-activity');
  await page.keyboard.press('d');
  await page.locator('.stats').waitFor();
  await shot('10-dashboard-running');
  await page.keyboard.press('a');
  await page.locator('.tag.staff').first().waitFor();
  await shot('11-agents');
  await page.locator('.card[data-pane] .open').first().click();
  await page.locator('.agent-overlay').waitFor();
  await shot('12-agent-view');
  await page.keyboard.press('Escape');
  await page.locator('.agent-overlay').waitFor({ state: 'detached' });
  await page.click('.side a[data-nav="settings"]');
  await page.locator('.set-block h3', { hasText: 'Herdr' }).waitFor();
  const exported = await (await fetch(`${base}/api/c/acme/export`)).json();
  assert.equal(exported.format, 'one-way-out-company/1');
  assert.ok(!JSON.stringify(exported).includes('"session"'), 'an export carries nothing tied to this machine');
  await shot('13-settings');
  await page.keyboard.press('?');
  await page.locator('.help-overlay').waitFor();
  await page.keyboard.press('Escape');

  // ── Import the export as a second company ──
  const imp = await (await fetch(`${base}/api/companies/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ bundle: exported }) })).json();
  assert.ok(imp.ok && imp.company.id !== 'acme', 'an import never overwrites');

  // ── Phone width ──
  await page.setViewportSize({ width: 390, height: 800 });
  await page.keyboard.press('d');
  await shot('14-phone');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(wide <= 1, `no sideways scroll at phone width (${wide}px over)`);

  assert.deepEqual(problems, [], problems.join('\n'));
  console.log(`OK — e2e: founded, planned, approved, worked, reviewed, budgeted, paused, routines, activity, agents, settings, export/import, phone width.${shotsAt ? ` Screenshots in ${shotsAt}` : ''}`);
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error(e.message);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
