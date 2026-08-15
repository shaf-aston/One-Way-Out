// Pure core: raw Herdr snapshot -> view model. No I/O, no clock, no UI knowledge.
// Kept side-effect-free so it can be verified in isolation (npm run verify).

/** Statuses Herdr reports for an agent-bearing pane. */
const STATUSES = ['working', 'blocked', 'done', 'idle', 'unknown'];

/** A pane is "an agent" (not just a bare shell) when Herdr has attached agent state to it. */
function isAgentPane(pane, agentByPane) {
  const info = agentByPane.get(pane.pane_id);
  const status = (info?.agent_status ?? pane.agent_status) || 'unknown';
  const name = info?.display_agent ?? info?.agent ?? pane.display_agent ?? pane.agent ?? null;
  return status !== 'unknown' || name != null;
}

/** Human label for a pane, preferring agent identity over raw terminal title. */
function paneLabel(pane, info, isAgent) {
  const name = info?.display_agent ?? info?.agent ?? pane.display_agent ?? pane.agent ?? null;
  const title = info?.title ?? pane.title ?? null;
  if (isAgent) {
    const pretty = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Agent';
    return title && title !== name ? `${pretty} — ${title}` : pretty;
  }
  return title || 'Terminal';
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
    const agent = info?.display_agent ?? info?.agent ?? pane.display_agent ?? pane.agent ?? null;
    const label = paneLabel(pane, info, isAgent);

    if (isAgent) {
      counts.total += 1;
      counts[STATUSES.includes(status) ? status : 'unknown'] += 1;
    }
    return {
      id: pane.pane_id,
      label,
      agent,
      status,
      isAgent,
      focused: !!pane.focused,
      cwd: info?.cwd ?? pane.cwd ?? null,
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
            label: p.label,
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
      .map((p) => ({ id: p.id, label: p.label, cwd: p.cwd, workspace: w.label }))));
}
