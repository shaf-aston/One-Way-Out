// Pure core: the three places an agent can be put, and the exact arguments that put it there.
// No I/O — src/herdr.mjs runs what this decides.
//
// The three shapes are Herdr's own, named the same way, so there is nothing to translate:
//   beside     — share a page with panes already there  { type:'tab', tabId, split }
//   new page   — its own page inside a window           { type:'new_tab', workspaceId?, label? }
//   new window — a window of its own                    { type:'new_workspace', label?, tabLabel? }
import { isValidPaneId } from './ids.mjs';

/** Which way a pane splits from the one already there. Herdr accepts no others. */
export const SPLITS = ['right', 'down'];

/** Plain words for each destination, used wherever one is offered or reported. */
export const PLACES = {
  tab: 'beside the agents already on that page',
  new_tab: 'on its own page in that window',
  new_workspace: 'in a window of its own',
};

const text = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * Check a destination that came off the wire before anything acts on it (trust boundary).
 * Returns a NEW object holding only the fields Herdr is given — nothing a page sent survives
 * unless it is named here.
 * @returns {{ok:true, dest:object}|{ok:false, error:string}}
 */
export function validateDest(input) {
  const type = input?.type;
  if (!PLACES[type]) return { ok: false, error: 'Say where it should go.' };

  if (type === 'tab') {
    if (!isValidPaneId(input.tabId)) return { ok: false, error: 'That page is not one Herdr knows.' };
    const split = SPLITS.includes(input.split) ? input.split : 'down';
    // Splitting sideways again and again makes a pane so narrow that Claude Code quits on
    // startup (measured 2026-08-22), so sideways is never the default — down is.
    return { ok: true, dest: { type, tabId: input.tabId, split } };
  }

  if (type === 'new_tab') {
    if (input.workspaceId != null && !isValidPaneId(input.workspaceId)) {
      return { ok: false, error: 'That window is not one Herdr knows.' };
    }
    return { ok: true, dest: { type, workspaceId: input.workspaceId ?? null, label: text(input.label, 40) || null } };
  }

  return { ok: true, dest: { type, label: text(input.label, 40) || null } };
}

/** The `herdr pane move …` argument list for a checked destination. */
export function moveArgs(paneId, dest) {
  const args = ['pane', 'move', paneId];
  if (dest.type === 'tab') args.push('--tab', dest.tabId, '--split', dest.split);
  else if (dest.type === 'new_tab') {
    args.push('--new-tab');
    if (dest.workspaceId) args.push('--workspace', dest.workspaceId);
    if (dest.label) args.push('--label', dest.label);
  } else {
    args.push('--new-workspace');
    if (dest.label) args.push('--label', dest.label);
  }
  args.push('--no-focus');
  return args;
}

/**
 * Where a NEW agent should be started, given where it is meant to end up.
 * Herdr's `agent start` can only split into a page that already exists, so the other two
 * destinations are done in two moves: start it somewhere, then move it. That is safe —
 * a move keeps the agent's terminal and its conversation (spike S0, 2026-08-22).
 * @returns {{start:{tabId?:string, split?:string}, then:object|null}}
 */
export function startPlan(dest) {
  if (dest.type === 'tab') return { start: { tabId: dest.tabId, split: dest.split }, then: null };
  return { start: {}, then: dest };
}

/**
 * Did the agent survive being moved? Herdr keeps the same terminal when it merely re-parents
 * the pane; a different one means it started the agent again and the conversation is gone.
 */
export function moveKept(before, after) {
  if (!after) return { ok: false, error: 'That agent is no longer in Herdr after the move.' };
  if (before && after.terminalId && before.terminalId && after.terminalId !== before.terminalId) {
    return { ok: false, error: 'Herdr restarted that agent instead of moving it — its conversation is gone.' };
  }
  return { ok: true };
}
