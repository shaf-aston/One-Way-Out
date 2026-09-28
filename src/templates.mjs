// Pure: ready-made companies. One click at setup hires a whole team, each with a title, a job
// and someone to report to — every one of them can be edited or let go afterwards.

const ceo = {
  name: 'CEO', title: 'Chief Executive', model: 'opus',
  job: 'Own the mission. Turn each goal into clear issues, assign them to the right person, '
    + 'check the finished work against the goal, and ask for a hire only when nobody on the team fits.',
};

export const TEMPLATES = [
  {
    id: 'solo',
    name: 'Just a CEO',
    why: 'One agent that plans and does the work itself. Hire more later.',
    team: [{ ...ceo, job: `${ceo.job} Until you hire anyone, do the work yourself.` }],
  },
  {
    id: 'small',
    name: 'CEO + 2 engineers',
    why: 'The CEO splits each goal; two engineers build it.',
    team: [
      ceo,
      { name: 'Ada', title: 'Engineer', model: 'sonnet', reportsTo: 'ceo', job: 'Build what your issue asks for, test it, and say exactly what you changed.' },
      { name: 'Linus', title: 'Engineer', model: 'sonnet', reportsTo: 'ceo', job: 'Build what your issue asks for, test it, and say exactly what you changed.' },
    ],
  },
  {
    id: 'team',
    name: 'CEO, tech lead, 3 engineers, reviewer',
    why: 'A lead breaks work down, engineers build, a reviewer checks before it is done.',
    team: [
      ceo,
      { name: 'Lead', title: 'Tech Lead', model: 'opus', reportsTo: 'ceo', job: 'Break each issue you are given into smaller issues for your engineers, keep their files from overlapping, and check their work fits together.' },
      { name: 'Ada', title: 'Engineer', model: 'sonnet', reportsTo: 'lead', job: 'Build what your issue asks for, test it, and say exactly what you changed.' },
      { name: 'Grace', title: 'Engineer', model: 'sonnet', reportsTo: 'lead', job: 'Build what your issue asks for, test it, and say exactly what you changed.' },
      { name: 'Linus', title: 'Engineer', model: 'haiku', reportsTo: 'lead', job: 'Take the small, mechanical issues: renames, docs, config, tidy-ups.' },
      { name: 'Rev', title: 'Reviewer', model: 'sonnet', reportsTo: 'ceo', job: 'Review finished work for bugs and for whether it meets its issue. Report problems as new issues.' },
    ],
  },
];
