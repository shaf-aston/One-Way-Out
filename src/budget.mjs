// Pure core: what each employee has used, and whether it has hit a cap. No I/O.
//
// Three kinds of budget, because Herdr does not report cost and each measure covers a gap in
// the others:
//   tasksPerDay     — issues finished today. Exact: this app is what marks them done.
//   activeMinPerDay — minutes spent in "working" today. Measured by the heartbeat, one tick at
//                     a time, so it is right to within one tick.
//   tokensPerMonth  — read off the agent's own status line when a turn ends. Best effort: a
//                     screen that shows no count adds nothing. It is never guessed.
// A cap of 0 means no cap.

/** The day and month a usage figure belongs to, in local time. */
export const dayKey = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const monthKey = (now) => dayKey(now).slice(0, 7);

/**
 * Usage with `add` counted in. A new day or month starts from zero for that measure.
 * @param {{day?:string, month?:string, tasks?:number, activeMs?:number, tokens?:number, allTokens?:number}} usage
 * @param {{tasks?:number, activeMs?:number, tokens?:number}} add
 */
export function addUsage(usage = {}, add = {}, now = Date.now()) {
  const day = dayKey(now), month = monthKey(now);
  const u = { ...usage };
  if (u.day !== day) { u.day = day; u.tasks = 0; u.activeMs = 0; }
  if (u.month !== month) { u.month = month; u.tokens = 0; }
  u.tasks = (u.tasks ?? 0) + (add.tasks ?? 0);
  u.activeMs = (u.activeMs ?? 0) + (add.activeMs ?? 0);
  u.tokens = (u.tokens ?? 0) + (add.tokens ?? 0);
  u.allTokens = (u.allTokens ?? 0) + (add.tokens ?? 0);
  u.allTasks = (u.allTasks ?? 0) + (add.tasks ?? 0);
  return u;
}

/** Usage as it stands today — yesterday's figures read as zero, without writing anything. */
export const current = (usage, now = Date.now()) => addUsage(usage, {}, now);

/**
 * Which cap, if any, this employee has reached.
 * @returns {null|{cap:'tasksPerDay'|'activeMinPerDay'|'tokensPerMonth', used:number, limit:number, words:string}}
 */
export function overBudget(employee, now = Date.now()) {
  const b = employee?.budget ?? {};
  const u = current(employee?.usage, now);
  const checks = [
    ['tasksPerDay', u.tasks, 'issues finished today'],
    ['activeMinPerDay', Math.floor(u.activeMs / 60000), 'minutes of work today'],
    ['tokensPerMonth', u.tokens, 'tokens this month'],
  ];
  for (const [cap, used, what] of checks) {
    if (b[cap] > 0 && used >= b[cap]) return { cap, used, limit: b[cap], words: `${used} of ${b[cap]} ${what}` };
  }
  return null;
}

/** How full each capped budget is, 0..1, for the bars on the page. Uncapped ones are left out. */
export function budgetBars(employee, now = Date.now()) {
  const b = employee?.budget ?? {};
  const u = current(employee?.usage, now);
  const bars = [];
  if (b.tasksPerDay > 0) bars.push({ cap: 'tasksPerDay', label: 'Issues today', used: u.tasks, limit: b.tasksPerDay });
  if (b.activeMinPerDay > 0) bars.push({ cap: 'activeMinPerDay', label: 'Minutes today', used: Math.floor(u.activeMs / 60000), limit: b.activeMinPerDay });
  if (b.tokensPerMonth > 0) bars.push({ cap: 'tokensPerMonth', label: 'Tokens this month', used: u.tokens, limit: b.tokensPerMonth });
  return bars.map((x) => ({ ...x, fill: Math.min(1, x.used / x.limit) }));
}

/**
 * The token count an agent's screen shows for its last turn, or null if it shows none.
 * Claude Code writes it into its status line as "↓ 12.3k tokens" or "1,234 tokens"; the LAST
 * one on screen is the turn that just ended. A screen with no such line adds nothing.
 */
export function readTokens(screen) {
  const all = [...String(screen ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\s+tokens\b/g)];
  if (!all.length) return null;
  const [, num, unit] = all[all.length - 1];
  const n = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = unit ? { k: 1e3, m: 1e6 }[unit.toLowerCase()] : 1;
  return Math.round(n * mult);
}
