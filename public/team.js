// Connections: wire agents together and give them one job.
// Three kinds — one leads · side by side · colleagues — each sends different instructions,
// built in src/team.mjs. Saved connections sit in the left rail, one click to reuse.
import { esc, get, post, autoGrow, attachPalette, agentsOf, confirmOnce, okToDiscard, onOverlayEscape } from './ui.js';

let model = null;      // latest map model, so the roster is always the live one
let teams = [];        // saved connections on disk
let kinds = {};        // {manages:{label,blurb,needsLeader}, …} — served by the API, not hardcoded here
let loadError = null;
let draft = blank();

export const setModel = (m) => { model = m; };

// The map shows a chip per saved connection, so it needs to hear when the list changes.
let onChange = () => {};
export const onTeamsChange = (fn) => { onChange = fn; };

function blank() { return { name: '', kind: 'manages', leaderId: '', memberIds: [], task: '' }; }

const sheet = () => document.querySelector('.team');

/** A job typed but not sent is work you can lose — every exit checks this first. */
const dirty = () => !!sheet()?.querySelector('textarea')?.value.trim();
const close = () => {
  if (!okToDiscard(dirty(), 'the job you were typing')) return false;
  document.querySelector('.team-overlay')?.remove();
  return true;
};
const needsLeader = () => kinds[draft.kind]?.needsLeader !== false;
const crew = () => draft.memberIds.length + (draft.leaderId ? 1 : 0);
const isLive = (id) => agentsOf(model).some((a) => a.id === id);

function renderRail() {
  sheet().querySelector('.flow-list').innerHTML = teams.length
    ? teams.map((t) => `<button class="flow-pick ${draft.id === t.id ? 'on' : ''}" data-team="${esc(t.id)}">
        <span>${esc(t.name)}</span>
        <small>${esc(kinds[t.kind]?.label ?? t.kind)} · ${t.memberIds.length + (t.leaderId ? 1 : 0)} agents</small>
      </button>`).join('')
    : `<p class="muted-note">${loadError
        ? esc(loadError)
        : 'No saved connections yet. Wire some agents together on the right, then Save.'}</p>`;
}

function renderRoster() {
  const box = sheet();
  const agents = agentsOf(model);
  const lead = needsLeader();
  const missing = [draft.leaderId, ...draft.memberIds].filter((id) => id && !isLive(id)).length;

  box.querySelector('.kind-pick').innerHTML = Object.entries(kinds).map(([key, k]) => `
    <button class="kind ${draft.kind === key ? 'on' : ''}" data-kind="${esc(key)}" aria-pressed="${draft.kind === key}">
      <span class="kind-name">${esc(k.label)}</span>
      <span class="kind-blurb">${esc(k.blurb)}</span>
      ${k.needsLeader ? '<span class="kind-rule">Star ★ the one that leads.</span>' : ''}
    </button>`).join('');

  box.querySelector('.team-list').innerHTML = agents.length
    ? agents.map((a) => {
        const isLead = a.id === draft.leaderId;
        return `<div class="team-row ${isLead ? 'lead' : ''}">
          ${lead ? `<button class="icon crown" data-lead="${esc(a.id)}" aria-pressed="${isLead}"
             title="${isLead ? 'This one leads — click to unset' : 'Make this one lead'}">${isLead ? '★' : '☆'}</button>` : ''}
          <span class="team-who">${esc(a.label)}<small>${esc(a.workspace)}</small></span>
          <label class="check">
            <input type="checkbox" data-member="${esc(a.id)}"
              ${draft.memberIds.includes(a.id) ? 'checked' : ''} ${isLead ? 'disabled' : ''} />
            ${lead ? 'in the team' : 'include'}
          </label>
        </div>`;
      }).join('')
    : `<p class="muted-note">No agents are running. Start one with “＋ New agent” on the map.</p>`;

  const gone = box.querySelector('.team-gone');
  gone.hidden = !missing;
  gone.textContent = missing
    ? `${missing} agent${missing === 1 ? '' : 's'} in this connection ${missing === 1 ? 'is' : 'are'} no longer running — pick ${missing === 1 ? 'a replacement' : 'replacements'} above.`
    : '';

  box.querySelector('.team-name').value = draft.name;
  box.querySelector('[data-act="delete"]').hidden = !draft.id;
  // Save and Send need the same thing: a real connection. Letting Save look available and
  // then rejecting it teaches the rule by bouncing you, which is the wrong way to teach it.
  const incomplete = crew() < 2 || (lead && !draft.leaderId);
  box.querySelector('[data-act="send"]').disabled = incomplete;
  box.querySelector('[data-act="save"]').disabled = incomplete;
  box.querySelector('.team-sum').textContent = summary();
}

/** One plain line telling you exactly what pressing Send will do. */
function summary() {
  const names = (ids) => ids.map((id) => agentsOf(model).find((a) => a.id === id)?.label ?? '?').join(', ');
  if (crew() < 2) return 'Pick two or more agents.';
  if (needsLeader()) {
    if (!draft.leaderId) return 'Pick which agent leads (★).';
    return `${names([draft.leaderId])} gets the job and hands parts of it to ${names(draft.memberIds)}.`;
  }
  const all = names([...(draft.leaderId ? [draft.leaderId] : []), ...draft.memberIds]);
  return draft.kind === 'parallel'
    ? `${all} each get the job and take separate files.`
    : `${all} each get the job and check with each other before overlapping.`;
}

function render() {
  if (!sheet()) return;
  renderRail();
  renderRoster();
}

function toast(msg, bad = false) {
  const el = sheet()?.querySelector('.team-msg');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

export async function loadTeams() {
  const r = await get('/api/teams');
  if (r.ok) { teams = r.teams; kinds = r.kinds; loadError = null; }
  else loadError = `Could not load saved connections: ${r.error}`;
  onChange(teams, loadError);
  return teams;
}

/** Pull a saved connection into the editor, composer included. */
function pick(id, guard = true) {
  if (guard && !okToDiscard(dirty(), 'the job you were typing')) return;
  const t = teams.find((x) => x.id === id);
  draft = t ? structuredClone(t) : blank();
  const box = sheet()?.querySelector('textarea');
  if (box) { box.value = draft.task ?? ''; autoGrow(box, 160); }
  render();
  box?.focus();
}

/**
 * Open the panel — optionally straight into a saved connection, which is what the
 * chips on the map do, so one you use daily is one click.
 */
export async function openTeam(teamId = null) {
  const already = sheet();
  await loadTeams();
  if (already) { if (teamId) pick(teamId); else render(); return; }
  // Opening fresh: nothing typed yet, so the guard has nothing to protect.

  draft = blank();
  const ov = document.createElement('div');
  ov.className = 'overlay team-overlay';
  ov.innerHTML = `<div class="sheet team">
    <div class="sheet-head">
      <h3 class="display">Connections</h3>
      <div class="actions">
        <span class="flow-msg team-msg" role="status" aria-live="polite"></span>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <div class="flows-body">
      <aside class="flow-rail">
        <button class="btn wide" data-act="new">＋ New connection</button>
        <div class="flow-list"></div>
        <p class="muted-note tip">Wire two or more running agents together, choose how they relate,
          and send one job. Each agent is told who the others are and how to reach them.</p>
      </aside>
      <section class="flow-edit">
        <div class="kind-pick" role="group" aria-label="How these agents relate"></div>
        <div class="team-list"></div>
        <p class="team-gone" hidden></p>
        <p class="team-sum"></p>
        <div class="composer">
          <textarea rows="2" maxlength="4000"
            placeholder="What is the job? Type “/” for a command…"></textarea>
        </div>
        <div class="flow-foot">
          <button class="btn primary" data-act="send">Send the job</button>
          <label class="fld inline"><span class="sr-only">Name</span>
            <input class="team-name" maxlength="80" placeholder="Name it to reuse it" />
          </label>
          <button class="btn" data-act="save">Save</button>
          <button class="btn" data-act="delete" hidden>Delete</button>
        </div>
      </section>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const box = ov.querySelector('textarea');
  attachPalette(box, () => agentsOf(model).find((a) => a.id === draft.leaderId)?.cwd ?? null);
  box.addEventListener('input', () => { draft.task = box.value; autoGrow(box, 160); });
  ov.querySelector('.team-name').addEventListener('input', (e) => { draft.name = e.target.value; });

  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return close();
    const t = e.target.closest('[data-team]')?.dataset.team;
    if (t) return pick(t);
    const kind = e.target.closest('[data-kind]')?.dataset.kind;
    if (kind) {
      draft.kind = kind;
      if (!needsLeader() && draft.leaderId) { draft.memberIds.push(draft.leaderId); draft.leaderId = ''; }
      if (needsLeader() && !draft.leaderId && draft.memberIds.length) draft.leaderId = draft.memberIds.shift();
      return render();
    }
    const lead = e.target.closest('[data-lead]')?.dataset.lead;
    if (lead) {
      const wasLeader = draft.leaderId;
      draft.leaderId = lead === wasLeader ? '' : lead;
      draft.memberIds = draft.memberIds.filter((m) => m !== draft.leaderId);
      if (wasLeader && wasLeader !== lead) draft.memberIds.push(wasLeader);
      return render();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return close();
    if (act === 'new') {
      if (!okToDiscard(dirty(), 'the job you were typing')) return;
      draft = blank(); box.value = ''; toast(''); return render();
    }

    if (act === 'save') {
      const clash = teams.find((x) => x.name.toLowerCase() === draft.name.trim().toLowerCase() && x.id !== draft.id);
      if (clash) return toast(`“${clash.name}” already exists — open it from the list to change it.`, true);
      const r = await post('/api/teams/save', draft);
      if (!r.ok) return toast(r.error, true);
      draft = structuredClone(r.team);
      await loadTeams();
      toast('Saved.');
      return render();
    }

    if (act === 'delete' && draft.id) {
      if (!confirmOnce(`Delete the connection “${draft.name}”? The agents keep running.`)) return;
      const r = await post('/api/teams/delete', { id: draft.id });
      if (!r.ok) return toast(r.error, true);
      draft = blank();
      box.value = '';
      await loadTeams();
      toast('Deleted.');
      return render();
    }

    if (act === 'send') {
      if (!box.value.trim()) { toast('Type the job first.', true); return box.focus(); }
      if (!confirmOnce(`${summary()}\n\nSend it now?`)) return;
      toast('Sending…');
      const r = await post('/api/teams/dispatch', { ...draft, task: box.value });
      toast(r.ok
        ? `Sent to ${r.sent} agent${r.sent === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} would not take it` : ''}.`
        : r.error, !r.ok);
      if (r.ok) { box.value = ''; draft.task = ''; }
    }
  });

  ov.addEventListener('change', (e) => {
    const id = e.target.dataset.member;
    if (!id) return;
    draft.memberIds = e.target.checked
      ? [...draft.memberIds, id]
      : draft.memberIds.filter((m) => m !== id);
    render();
  });

  if (teamId) pick(teamId, false); else render();
  box.focus();
}

/** Keep the roster honest while the panel sits open on a second screen. */
export function refreshTeam() {
  if (sheet()) renderRoster();
}

onOverlayEscape('.team-overlay', close);
