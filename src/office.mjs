// Service layer: runs the heartbeat. It reads a company, asks Herdr which of its employees are
// running and what they are doing, lets src/heartbeat.mjs decide, saves that, and then does
// what was decided — starting agents and typing briefs into them. It reaches Herdr only through
// src/herdr.mjs, and decides nothing itself.
import { mkdir } from 'node:fs/promises';
import { getSnapshot, readPane, runInPane, sendKeys, startAgent, movePane, closePane } from './herdr.mjs';
import { buildModel, listAgents } from './model.mjs';
import { startPlan, moveArgs } from './moves.mjs';
import { decide, oneLine } from './heartbeat.mjs';
import { readTokens } from './budget.mjs';
import { entry } from './activity.mjs';
import { issueKey } from './issues.mjs';
import { listCompanies, withCompany, scanWork, workPaths, retireWork } from './companies.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ');
// The literal text Claude Code shows on a folder it has never worked in before.
const TRUST_MENU = /Enter to confirm/;

/**
 * Dismiss the "do you trust this folder" menu, if one is showing — its default is already "yes",
 * so a bare Enter is the choice a person would make. Typed text arriving while that menu is up is
 * dropped outright (measured 2026-08-23), so this must be confirmed gone before any brief is sent.
 * A pane fresh from spawn reads blank for a moment, so the first look waits first.
 */
async function clearTrustPrompt(bin, paneId, waitMs) {
  for (let tries = 0; tries < 6; tries += 1) {
    await sleep(waitMs);
    const screen = await readPane(bin, paneId, 'text').catch(() => '');
    if (!TRUST_MENU.test(screen)) return;
    await sendKeys(bin, paneId, 'enter').catch(() => {});
  }
}

/**
 * Type a brief and keep nudging until it is provably taken. A large paste can lose its Enter to
 * render lag and sit typed but unsent, and agent_status cannot tell that from a real submit — only
 * the screen can: if our words (or Claude's "[Pasted text" placeholder) are still in the prompt,
 * it was never sent (both measured 2026-08-23).
 */
async function deliver(bin, paneId, text, { fresh = false, waitMs = 2000 } = {}) {
  if (fresh) await clearTrustPrompt(bin, paneId, waitMs);
  await runInPane(bin, paneId, text);
  const marker = norm(text).slice(0, 50);
  for (let tries = 0; tries < 8; tries += 1) {
    await sleep(waitMs + 500);
    const screen = norm(await readPane(bin, paneId, 'text').catch(() => ''));
    if (!screen.includes(marker) && !/\[Pasted text/.test(screen)) return;
    await sendKeys(bin, paneId, 'enter').catch(() => {});
  }
}

/**
 * Which pane each employee is running in right now. An employee is found by its conversation
 * (which survives a move) and, until Herdr reports one, by the pane it was started in.
 * @returns {{panes:Record<string,{paneId:string,status:string,workspaceId:string}|null>, sessions:Record<string,string>}}
 */
export function matchPanes(model, employees) {
  const agents = (model?.workspaces ?? []).flatMap((w) => w.tabs.flatMap((t) => t.panes
    .filter((p) => p.isAgent).map((p) => ({ ...p, workspaceId: w.id }))));
  const bySession = new Map(agents.filter((a) => a.session).map((a) => [a.session, a]));
  const byPane = new Map(agents.map((a) => [a.id, a]));
  const panes = {};
  const sessions = {};
  for (const e of employees) {
    if (e.state === 'terminated') { panes[e.id] = null; continue; }
    const a = (e.session && bySession.get(e.session)) || (!e.session && e.paneId ? byPane.get(e.paneId) : null) || null;
    panes[e.id] = a ? { paneId: a.id, status: a.status, workspaceId: a.workspaceId } : null;
    if (a?.session && a.session !== e.session) sessions[e.id] = a.session;
  }
  return { panes, sessions };
}

/**
 * @param {{bin:string, root:string, limits:object, agentCommand:string, log?:(msg:string)=>void}} opts
 */
export function createOffice({ bin, root, limits = {}, agentCommand = 'claude', log = console.error }) {
  const busy = new Set();         // companies mid-tick: one beat at a time each
  const sending = new Map();      // employee key -> promise, so two briefs never interleave

  async function snapshotModel() {
    const snap = await getSnapshot(bin);
    return snap.ok ? buildModel(snap.snapshot) : null;
  }

  /** Where a new employee's agent should appear: beside its colleagues if any are running. */
  function destFor(company, panes) {
    const ws = Object.values(panes).find(Boolean)?.workspaceId;
    return ws ? { type: 'new_tab', workspaceId: ws, label: null } : { type: 'new_workspace', label: company.name.slice(0, 40) };
  }

  async function spawn(company, employee, dest) {
    const plan = startPlan(dest);
    const argv = [...agentCommand.split(/\s+/).filter(Boolean), '--model', employee.model];
    let paneId = await startAgent(bin, { label: `${employee.name} · ${company.name}`.slice(0, 60), cwd: company.folder, argv, ...plan.start });
    if (plan.then) {
      const moved = await movePane(bin, moveArgs(paneId, plan.then)).catch(() => null);
      if (moved?.pane?.pane_id) paneId = moved.pane.pane_id;
    }
    return paneId;
  }

  /** Carry out one effect. Slow (it waits on the agent), so it runs outside the company lock. */
  async function carryOut(cid, effect, ctx) {
    const k = `${cid}/${effect.employeeId}`;
    const prev = sending.get(k) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const pane = ctx.panes[effect.employeeId];
      if (effect.type === 'brief') {
        if (pane) await deliver(bin, pane.paneId, effect.text, { waitMs: limits.deliverWaitMs });
        return;
      }
      // 'start': make sure the employee has an agent, then give it the issue.
      try {
        let paneId = pane?.paneId;
        const fresh = !paneId;
        if (!paneId) paneId = await spawn(ctx.company, ctx.employees.find((e) => e.id === effect.employeeId), destFor(ctx.company, ctx.panes));
        ctx.panes[effect.employeeId] = { paneId, status: 'idle', workspaceId: pane?.workspaceId };
        await deliver(bin, paneId, effect.text, { fresh, waitMs: limits.deliverWaitMs });
        await withCompany(root, cid, (s) => {
          const e = s.employees.find((x) => x.id === effect.employeeId);
          const i = s.issues.find((x) => x.id === effect.issueId);
          if (e && fresh) { e.paneId = paneId; e.session = null; }
          if (i?.work) { i.work.starting = false; i.work.briefedAt = Date.now(); }
          return { state: s };
        });
      } catch (err) {
        log(`could not start ${effect.employeeId}: ${err.message || err}`);
        await withCompany(root, cid, (s) => {
          const i = s.issues.find((x) => x.id === effect.issueId);
          if (i) {
            i.status = 'todo';
            i.work = null;
            i.comments.push({ by: 'system', at: Date.now(), text: `Could not start the agent: ${String(err.message || err).slice(0, 300)}` });
          }
          const e = s.employees.find((x) => x.id === effect.employeeId);
          if (e) e.state = 'paused';
          return { state: s, log: [entry('system', 'failed', { type: 'employee', id: effect.employeeId },
            `Could not start ${e?.name ?? effect.employeeId}'s agent, so they were paused: ${String(err.message || err).slice(0, 200)}`)] };
        }).catch(() => {});
      }
    });
    sending.set(k, run.finally(() => { if (sending.get(k) === run) sending.delete(k); }));
    return run;
  }

  /** One heartbeat of one company. Returns what it decided, for the checks and the CLI. */
  async function tick(cid, { dry = false, force = false } = {}) {
    if (busy.has(cid)) return null;
    busy.add(cid);
    try {
      const model = await snapshotModel();
      if (!model) return null;               // Herdr is down: decide nothing on a blind guess
      const paths = workPaths(root, cid);
      let decided;
      let ctx;
      await withCompany(root, cid, async (state) => {
        if (!state.company.running && !force) return {};
        const { panes, sessions } = matchPanes(model, state.employees);
        for (const [id, session] of Object.entries(sessions)) {
          const e = state.employees.find((x) => x.id === id);
          if (e) e.session = session;
        }
        // Tokens are read once, when a turn ends — the moment the status line holds the whole
        // turn's count — rather than every beat.
        const tokens = {};
        for (const e of state.employees) {
          const p = panes[e.id];
          if (e.live?.lastStatus === 'working' && p && p.status !== 'working') {
            const n = readTokens(await readPane(bin, p.paneId, 'text').catch(() => ''));
            if (n) tokens[e.id] = n;
          }
        }
        const work = await scanWork(root, cid);
        decided = decide(state, { panes, ...work, tokens }, Date.now(), { ...limits, paths });
        ctx = { company: decided.state.company, employees: decided.state.employees, panes };
        if (dry) return {};
        for (const issueId of work.delegations.keys()) await retireWork(paths.delegate(issueId));
        return { state: decided.state, log: decided.log };
      });
      if (!decided || dry) return decided ?? null;
      // Agents are told to write here, so it must exist before anyone is briefed.
      if (decided.effects.length) await mkdir(paths.dir, { recursive: true });
      for (const effect of decided.effects) carryOut(cid, effect, ctx).catch((e) => log(`effect failed: ${e.message || e}`));
      return decided;
    } finally {
      busy.delete(cid);
    }
  }

  async function tickAll() {
    for (const c of await listCompanies(root)) {
      if (c.running) await tick(c.id).catch((e) => log(`heartbeat failed for ${c.id}: ${e.message || e}`));
    }
  }

  let timer = null;
  return {
    tick,
    tickAll,
    matchPanes,
    start(ms) { if (!timer) timer = setInterval(tickAll, ms); },
    stop() { clearInterval(timer); timer = null; },
    /** Type a message to one employee now (a comment on its issue, a rejection note). */
    tell: (cid, employeeId, text, panes) => carryOut(cid, { type: 'brief', employeeId, text: oneLine(text) }, { panes }),
    close: (paneId) => closePane(bin, paneId),
    snapshotModel,
    issueKey,
  };
}

/** Every agent on the map that is not already an employee of this company — the "hire" list. */
export function unhired(model, employees) {
  const taken = new Set(employees.flatMap((e) => [e.session, e.paneId]).filter(Boolean));
  return listAgents(model).filter((a) => !taken.has(a.session) && !taken.has(a.id));
}
