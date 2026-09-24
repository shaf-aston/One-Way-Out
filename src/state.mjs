/**
 * Where a card goes on the board.
 *
 * The rule is Agent Orchestrator's, and it is the whole point: a card's column is **worked out
 * from facts every time it is drawn, never stored**. So nothing can drag a card somewhere the
 * facts disagree with, and the board cannot quietly go stale.
 *
 * The states themselves are not written here. They live in `config.json` as an ordered list,
 * and the order IS the rule — first match wins. That is what fixes the contradiction measured
 * on 2026-09-02, where the "Needs you" lane was headed by four agents badged "Done": nothing
 * decided which fact beat which, so both were true at once and the page said both.
 *
 * Deliberately not an expression language. A `match` is equality on a fact, or `over`/`under`
 * on a number. Anything richer means evaluating strings out of a config file, which is a new
 * language to learn and a new thing to get wrong.
 */

/** Does one fact satisfy one clause? */
function fits(got, want) {
  if (want && typeof want === 'object') {
    if ('over' in want) return typeof got === 'number' && got > want.over;
    if ('under' in want) return typeof got === 'number' && got < want.under;
    return false;
  }
  return got === want;
}

/**
 * The first state whose every clause holds. A state with an empty `match` matches anything,
 * so a list ending in one always gives an answer.
 * @param {object} agent - one pane, as the model describes it
 * @param {Array<{id:string, match:object}>} states - ordered; earlier wins
 * @returns {object|null} the matching state, or null if the list has no catch-all
 */
export function stateOf(agent, states = []) {
  return states.find((s) => Object.entries(s.match ?? {}).every(([k, want]) => fits(agent?.[k], want))) ?? null;
}

/**
 * Every state in config order, each with the agents that landed in it. Empty states come back
 * too — a column that is empty is information ("nothing needs you"), not an absence.
 * @param {Array<object>} agents
 * @param {Array<object>} states
 */
export function board(agents = [], states = []) {
  const held = new Map(states.map((s) => [s.id, []]));
  for (const a of agents) {
    const s = stateOf(a, states);
    if (s) held.get(s.id).push(a);
  }
  return states.map((s) => ({ ...s, agents: held.get(s.id) }));
}

/**
 * The board as the browser needs it: every column in config order, each naming the panes in it.
 * Only ids cross the wire — the browser already holds the panes, and sending them twice is how
 * two copies of the same agent start disagreeing.
 *
 * The rule stays on this side on purpose. The view draws columns; it does not decide them.
 * @param {object} model - the built model
 * @param {Array<object>} states
 */
export function boardOf(model, states = []) {
  const agents = (model?.workspaces ?? []).flatMap((w) => w.tabs.flatMap((t) => t.panes.filter((p) => p.isAgent)));
  return board(agents, states).map(({ id, label, blurb, tone, cardsPerLane, agents: held }) => ({
    id, label, blurb, tone, cardsPerLane, ids: held.map((a) => a.id),
  }));
}

/**
 * How wide each column should be, in lanes.
 *
 * A column holding nine cards and a column holding one do not deserve the same width: the busy
 * one becomes a long vertical list you have to scroll, while the quiet one holds a screenful of
 * empty. So width is earned — a column gets one lane per `cardsPerLane` cards in it, capped at
 * `maxLanes`, and its cards then sit side by side across those lanes instead of stacking.
 *
 * Both numbers are config, and so is the smallest a lane may be. The cap matters: without it one
 * busy column takes the whole row and the others are squeezed to nothing, which is the same
 * problem in the other direction.
 *
 * Count alone is not enough, though. Measured 2026-09-03: five quiet agents earned two lanes and
 * three waiting on an answer earned one, so half the row went to the column with nothing to do.
 * A state may therefore set its own `cardsPerLane` in config — a column you can ignore packs
 * more cards into a lane and leaves the width to the one you cannot.
 *
 * @param {Array<{ids:string[], cardsPerLane?:number}>} cols - the board, from boardOf
 * @param {{cardsPerLane?:number, maxLanes?:number}} how
 * @returns {number[]} lanes per column, in the same order
 */
export function lanes(cols = [], how = {}) {
  const cap = Math.max(1, how.maxLanes ?? 3);
  return cols.map((c) => {
    const per = Math.max(1, c?.cardsPerLane ?? how.cardsPerLane ?? 4);
    return Math.min(cap, Math.max(1, Math.ceil((c.ids?.length ?? 0) / per)));
  });
}

/**
 * Reject a states list that cannot answer. Called at startup so a bad edit to config.json is a
 * loud message at the terminal, not a card that silently vanishes off the board.
 * @returns {string[]} what is wrong; empty means it is usable
 */
export function checkStates(states) {
  const bad = [];
  if (!Array.isArray(states) || !states.length) return ['states must be a non-empty list'];
  const seen = new Set();
  for (const [i, s] of states.entries()) {
    const where = `state ${i + 1}${s?.id ? ` (${s.id})` : ''}`;
    if (!s?.id) bad.push(`${where} has no id`);
    else if (seen.has(s.id)) bad.push(`${where} repeats an id`);
    else seen.add(s.id);
    if (!s?.label) bad.push(`${where} has no label`);
    if (!s?.tone) bad.push(`${where} has no tone, so it has no colour`);
    if (s?.match && typeof s.match !== 'object') bad.push(`${where} has a match that is not a set of facts`);
  }
  if (states.some((s) => !Object.keys(s?.match ?? {}).length)) return bad;
  bad.push('the last state must have an empty match, or an agent can match nothing and disappear');
  return bad;
}
