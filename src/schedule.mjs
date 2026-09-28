// Pure core: is a schedule due? No I/O, no timers — the caller passes `now`.
//
// Three shapes and no cron syntax, because three cover what a person actually asks for and
// each one reads as a sentence: "every 30 minutes", "daily at 09:00", "weekdays at 09:00".
// Times are the machine's local time — the same clock the person reading the page is on.

const MIN = 60 * 1000;

/** Today's `HH:MM` as a timestamp on the same local day as `now`. */
function todayAt(at, now) {
  const [h, m] = String(at).split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/**
 * Has `schedule` come round since `lastAt`?
 * A schedule that has never fired is due at its first slot from now on — never retroactively,
 * so switching a routine on at 3pm does not fire this morning's 9am one.
 * @param {{kind:'every'|'daily'|'weekdays', everyMin?:number, at?:string}} schedule
 * @param {number|null} lastAt - when it last fired
 * @param {number} now
 * @param {number|null} [since] - when it was switched on, for one that has never fired
 */
export function due(schedule, lastAt, now, since = null) {
  if (!schedule) return false;
  if (schedule.kind === 'every') {
    const every = Math.max(1, schedule.everyMin ?? 60) * MIN;
    return now - (lastAt ?? since ?? now - every) >= every;
  }
  const slot = todayAt(schedule.at ?? '09:00', now);
  if (now < slot) return false;
  const day = new Date(now).getDay();
  if (schedule.kind === 'weekdays' && (day === 0 || day === 6)) return false;
  const from = lastAt ?? since;
  return from == null ? now - slot < 5 * MIN : from < slot;
}

/** The schedule in words, for the page. */
export function describeSchedule(s) {
  if (!s) return 'never';
  if (s.kind === 'every') {
    const m = s.everyMin ?? 60;
    return m % 1440 === 0 ? `every ${m / 1440} day${m === 1440 ? '' : 's'}`
      : m % 60 === 0 ? `every ${m / 60} hour${m === 60 ? '' : 's'}` : `every ${m} minutes`;
  }
  return `${s.kind === 'weekdays' ? 'weekdays' : 'daily'} at ${s.at ?? '09:00'}`;
}
