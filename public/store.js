// The company this page is looking at, and the one way to change it.
//
// Every company page draws from ONE read (`/api/c/<id>/state`), polled here and handed to
// whoever is listening — not a fetch per panel. A change posts, then reads again at once, so
// what you just did is on screen before the next poll comes round.
import { get, post, headMsg } from './ui.js';

const KEY = 'one-way-out.company';
let companies = [];
let templates = [];
let current = null;          // the company id
let state = null;            // the last /state read
let sig = '';
const listeners = new Set();

const remember = (id) => { try { localStorage.setItem(KEY, id ?? ''); } catch {} };
const recalled = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export const cid = () => current;
export const theState = () => state;
export const allCompanies = () => companies;
export const allTemplates = () => templates;

/** Be told whenever the state changes. Called at once with what is there now. */
export function onState(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
const tell = () => { for (const fn of listeners) fn(state); };

/** Read the company list; pick the remembered one, or the first. */
export async function loadCompanies() {
  const r = await get('/api/companies');
  if (!r.ok) return false;
  companies = r.companies;
  templates = r.templates;
  const want = current ?? recalled();
  current = companies.some((c) => c.id === want) ? want : companies[0]?.id ?? null;
  remember(current);
  return true;
}

export async function choose(id) {
  current = id;
  remember(id);
  state = null;
  sig = '';
  tell();
  await refresh();
}

/** Read the company again. Only tells listeners if anything they draw from changed. */
export async function refresh() {
  if (!current) { if (state) { state = null; tell(); } return; }
  const r = await get(`/api/c/${current}/state`);
  if (!r.ok) {
    if (/does not exist/.test(r.error ?? '')) { await loadCompanies(); state = null; tell(); }
    return;
  }
  const next = JSON.stringify(r);
  if (next === sig) return;
  sig = next;
  state = r;
  tell();
}

/**
 * Change something in the company: post, say what went wrong if it did, and redraw.
 * @returns {Promise<object|null>} the server's answer, or null if it failed (already reported)
 */
export async function act(path, body = {}, { quiet = false } = {}) {
  const r = await post(`/api/c/${current}/${path}`, body);
  if (!r.ok) { headMsg(r.error || 'That did not work.'); return null; }
  if (!quiet) headMsg('');
  await refresh();
  return r;
}

/* ── Small readers every page needs ── */
export const employee = (id) => state?.employees.find((e) => e.id === id) ?? null;
export const issueById = (id) => state?.issues.find((i) => i.id === id) ?? null;
export const keyOf = (i) => `${state?.company.prefix ?? 'CO'}-${i?.number ?? '?'}`;
export const liveOf = (employeeId) => state?.live?.[employeeId] ?? null;
export const activeStaff = () => (state?.employees ?? []).filter((e) => e.state !== 'terminated');
export const pending = () => (state?.approvals ?? []).filter((a) => a.state === 'pending');
