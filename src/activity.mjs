// Pure: the activity log's one line shape, and how the page narrows it. No I/O.
// Every change to a company — by you, by an agent, or by the heartbeat — is one of these,
// appended and never rewritten, so "what happened and who did it" always has an answer.

/**
 * @param {string} actor - 'you', 'system', or an employee id
 * @param {string} verb - what happened, past tense: 'created', 'assigned', 'finished'…
 * @param {{type:string, id:string}|null} object - what it happened to
 * @param {string} detail - one plain sentence
 */
export const entry = (actor, verb, object, detail = '', at = Date.now()) =>
  ({ at, actor, verb, object: object ?? null, detail: String(detail).slice(0, 400) });

/** Newest first, narrowed by who did it, what it was about, or words in it. */
export function filterActivity(lines = [], { actor, type, id, q, limit = 200 } = {}) {
  const words = String(q ?? '').toLowerCase().trim();
  return lines
    .filter((l) => (!actor || l.actor === actor)
      && (!type || l.object?.type === type)
      && (!id || l.object?.id === id)
      && (!words || `${l.verb} ${l.detail} ${l.actor}`.toLowerCase().includes(words)))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
