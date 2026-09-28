// Goals — what the company is aiming at, under its mission. Each goal shows how far its issues
// have got, and "Plan it" asks the CEO to split it into issues for the team.
import { esc } from './ui.js';
import { theState } from './store.js';
import { goalForm, planGoal, issueForm, issueCard } from './parts.js';

export function draw(el, s) {
  const kidsOf = (id) => s.goals.filter((g) => (g.parentId ?? null) === id);
  const issuesOf = (g) => s.issues.filter((i) => i.goalId === g.id && i.status !== 'cancelled');
  const node = (g) => {
    const list = issuesOf(g);
    const done = list.filter((i) => i.status === 'done').length;
    const planning = list.find((i) => i.kind === 'plan' && !['done', 'cancelled'].includes(i.status));
    return `<li class="goal ${g.done ? 'achieved' : ''}">
      <div class="goal-row">
        <button class="goal-title linkish" data-goal="${esc(g.id)}" data-act="edit">${g.done ? '✓ ' : ''}${esc(g.title)}</button>
        <span class="progress" title="${done} of ${list.length} issues done"><span style="width:${list.length ? Math.round((done / list.length) * 100) : 0}%"></span></span>
        <small>${done}/${list.length}</small>
        <span class="goal-acts">
          ${planning ? `<a class="tag" href="#/issues/${esc(planning.id)}">being planned</a>` : `<button class="btn tiny" data-goal="${esc(g.id)}" data-act="plan" title="The CEO splits it into issues">Plan it</button>`}
          <button class="btn tiny" data-goal="${esc(g.id)}" data-act="issue">＋ Issue</button>
          <button class="btn tiny" data-goal="${esc(g.id)}" data-act="sub">＋ Sub-goal</button>
        </span>
      </div>
      ${g.detail ? `<p class="goal-detail">${esc(g.detail)}</p>` : ''}
      ${list.filter((i) => i.status !== 'done' && !i.parentId).length ? `<div class="goal-issues">${list.filter((i) => i.status !== 'done' && !i.parentId).slice(0, 6).map((i) => issueCard(i, { compact: true })).join('')}</div>` : ''}
      ${kidsOf(g.id).length ? `<ul class="goals">${kidsOf(g.id).map(node).join('')}</ul>` : ''}
    </li>`;
  };
  el.innerHTML = `<div class="page-head"><h2 class="display">Goals</h2>
      <div class="actions"><button class="btn primary" data-act="new">＋ Goal</button></div></div>
    <div class="mission-card"><small>Mission</small><p>${s.company.mission ? esc(s.company.mission) : '<a href="#/settings">Write the mission</a> — every goal sits under it, and every brief starts with it.'}</p></div>
    ${s.goals.length ? `<ul class="goals top">${kidsOf(null).map(node).join('')}</ul>`
      : '<div class="state"><p>No goals yet. A goal is an outcome, like “Launch the beta”. Add one, then press <b>Plan it</b> and the CEO turns it into issues.</p></div>'}`;
}

export async function click(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const g = theState().goals.find((x) => x.id === b.dataset.goal) ?? null;
  if (b.dataset.act === 'new') return goalForm();
  if (b.dataset.act === 'edit') return goalForm(g);
  if (b.dataset.act === 'sub') return goalForm(null, { parentId: g.id });
  if (b.dataset.act === 'plan') return planGoal(g.id);
  if (b.dataset.act === 'issue') return issueForm(null, { goalId: g.id });
}
