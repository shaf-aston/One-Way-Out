// Pure core: raw Herdr snapshot -> view model. No I/O, no clock, no UI knowledge.
// Kept side-effect-free so it can be verified in isolation (npm run verify).
import { isBanner } from './labels.mjs';

/** Statuses Herdr reports for an agent-bearing pane. */
const STATUSES = ['working', 'blocked', 'done', 'idle', 'unknown'];

/** Which engine is running here — `claude`, `codex`. Absent on a bare shell, which is the tell. */
const engineOf = (pane, info) => info?.agent ?? pane.agent ?? null;

/** A pane is "an agent" (not just a bare shell) when Herdr has attached agent state to it. */
function isAgentPane(pane, agentByPane) {
  const info = agentByPane.get(pane.pane_id);
  const status = (info?.agent_status ?? pane.agent_status) || 'unknown';
  return status !== 'unknown' || engineOf(pane, info) != null;
}

/**
 * The name the operator gave this agent. Herdr stores it as `name` on the agent and `label`
 * on the pane — it is the whole point of naming one, so it wins over everything else.
 */
const ownName = (pane, info) => (info?.name ?? pane.label ?? '').trim() || null;

/**
 * The title the chat gave itself, which is not the same thing as the name he set.
 * It leads with a status glyph (◑ ✳ ✻) duplicating the status shown beside it, so that goes.
 * Agents only: a bare shell's terminal title is just its program name ("powershell.exe").
 */
function selfTitle(pane, info, isAgent) {
  if (!isAgent) return null;
  const raw = info?.terminal_title_stripped ?? pane.terminal_title_stripped ?? null;
  return raw ? (raw.replace(/^[^\p{L}\p{N}]+/u, '').trim() || null) : null;
}

/** What the card says in big text: his name for it, else the engine, else nothing useful. */
function paneLabel(pane, info, isAgent) {
  if (!isAgent) return 'Terminal';
  const own = ownName(pane, info);
  if (own) return own;
  const engine = engineOf(pane, info);
  return engine ? engine.charAt(0).toUpperCase() + engine.slice(1) : 'Agent';
}

/**
 * Build the view model the dashboard renders.
 * @param {object} snapshot - the `.result.snapshot` object from `herdr api snapshot`.
 * @returns normalized, UI-agnostic model.
 */
export function buildModel(snapshot) {
  const s = snapshot || {};
  const workspaces = Array.isArray(s.workspaces) ? s.workspaces : [];
  const tabs = Array.isArray(s.tabs) ? s.tabs : [];
  const panes = Array.isArray(s.panes) ? s.panes : [];
  const agents = Array.isArray(s.agents) ? s.agents : [];

  const agentByPane = new Map(agents.map((a) => [a.pane_id, a]));

  const counts = { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0, total: 0 };
  const needsYou = [];

  const viewPane = (pane) => {
    const info = agentByPane.get(pane.pane_id);
    const isAgent = isAgentPane(pane, agentByPane);
    const status = (info?.agent_status ?? pane.agent_status) || 'unknown';
    const agent = engineOf(pane, info);
    let label = paneLabel(pane, info, isAgent);
    let title = selfTitle(pane, info, isAgent);
    // An agent nobody named shows the program's own banner — "Claude", "Claude Code (2)".
    // Measured 2026-09-01: 7 of the 10 cards on this map read that same word, and the only
    // thing telling them apart was the small grey line under it. Where the chat has given
    // itself a subject, that IS the useful name, so the two swap over. Nothing is invented:
    // both strings already came from the agent.
    if (isAgent && title && isBanner(label)) { label = title; title = null; }

    if (isAgent) {
      counts.total += 1;
      counts[STATUSES.includes(status) ? status : 'unknown'] += 1;
    }
    return {
      // `id` is Herdr's handle for this pane RIGHT NOW. Moving a pane reassigns it, so it is
      // only ever an argument handed straight back to Herdr — never something we remember.
      id: pane.pane_id,
      // These two are the agent itself and survive a move, so anything saved keys on them.
      terminalId: info?.terminal_id ?? pane.terminal_id ?? null,
      session: info?.agent_session?.value ?? pane.agent_session?.value ?? null,
      label,
      title: title && title !== label ? title : null,   // a second, quieter line — never a repeat
      agent,
      status,
      isAgent,
      focused: !!pane.focused,
      cwd: info?.cwd ?? pane.cwd ?? null,
      // Herdr bumps this on every screen change; a number that stops moving is a stuck agent.
      revision: info?.revision ?? pane.revision ?? null,
    };
  };

  // Two Herdr windows open on one folder carry the same label, which makes two cards on the
  // map indistinguishable. Where a label repeats, the window number goes into it.
  const rawLabel = (w) => w.label || `Workspace ${w.number ?? ''}`.trim();
  const labelCount = new Map();
  for (const w of workspaces) labelCount.set(rawLabel(w), (labelCount.get(rawLabel(w)) ?? 0) + 1);
  const wsLabel = (w, i) =>
    (labelCount.get(rawLabel(w)) > 1 ? `${rawLabel(w)} (${w.number ?? i + 1})` : rawLabel(w));

  const model = {
    workspaces: workspaces.map((w, i) => ({
      id: w.workspace_id,
      label: wsLabel(w, i),
      focused: !!w.focused,
      tabs: tabs
        .filter((t) => t.workspace_id === w.workspace_id)
        .map((t) => ({
          id: t.tab_id,
          label: t.label || `Tab ${t.number ?? ''}`.trim(),
          focused: !!t.focused,
          panes: panes
            .filter((p) => p.tab_id === t.tab_id)
            .map(viewPane),
        })),
    })),
    counts,
    needsYou,
  };

  // "Needs you" = agents that are blocked (want input) or done (finished, awaiting you).
  for (const w of model.workspaces) {
    for (const t of w.tabs) {
      for (const p of t.panes) {
        if (p.isAgent && (p.status === 'blocked' || p.status === 'done')) {
          needsYou.push({
            paneId: p.id,
            session: p.session,   // what a dismissal is remembered against, since paneId moves
            label: p.label,
            title: p.title,
            agent: p.agent,
            status: p.status,
            cwd: p.cwd,
            workspaceLabel: w.label,
          });
        }
      }
    }
  }
  // blocked first (actively stuck), then done.
  needsYou.sort((a, b) => (a.status === b.status ? 0 : a.status === 'blocked' ? -1 : 1));

  return model;
}

/**
 * Flatten the map to just its agents — the whole map, or one workspace.
 * Bare shells are left out: they are your own terminals, not agents.
 * @param {object} model - the value from buildModel
 * @param {string|null} workspaceId - null = all workspaces
 */
export function listAgents(model, workspaceId = null) {
  return (model?.workspaces ?? [])
    .filter((w) => !workspaceId || w.id === workspaceId)
    .flatMap((w) => w.tabs.flatMap((t) => t.panes
      .filter((p) => p.isAgent)
      .map((p) => ({ id: p.id, session: p.session, label: p.label, cwd: p.cwd, workspace: w.label }))));
}

/**
 * Act on the number of agents that was agreed to, or on none of them. The page shows a count it
 * read up to a poll ago, and its question can sit on screen for as long as it is left there — so
 * by the time the answer comes back the map may hold more agents than were ever named. Both the
 * things this guards reach live sessions and neither can be undone: closing an agent, and
 * pressing Enter on the menu an agent is stopped at.
 * @param {number} found - agents there right now, counted fresh
 * @param {*} agreed - the number the page put in front of the operator
 * @param {{did:string, state:string, button:string}} [words] - how to say it: what was not done,
 *   what those agents are doing instead, and the button to press once you have looked again.
 */
export function checkAgreedCount(found, agreed, words = { did: 'closed', state: 'running', button: 'Close' }) {
  const there = `${found} agent${found === 1 ? '' : 's'}`;
  if (!Number.isInteger(agreed)) {
    return { ok: false, error: `Nothing was ${words.did}: the page did not say how many agents you agreed to.` };
  }
  if (agreed !== found) {
    return { ok: false, error: `Nothing was ${words.did}: ${there} ${found === 1 ? 'is' : 'are'} ${words.state} now,`
      + ` not the ${agreed} you were asked about. Have another look, then press ${words.button} again.` };
  }
  return { ok: true };
}
