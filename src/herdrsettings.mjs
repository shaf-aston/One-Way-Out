// Pure: which Herdr terminal settings the map may change, and how to patch config.toml text.
// No I/O. A fixed allow-list, so a bad request can never write an arbitrary line into the file.

const THEMES = ['catppuccin', 'terminal', 'tokyo-night', 'dracula', 'nord', 'gruvbox', 'one-dark', 'solarized', 'kanagawa', 'rose-pine', 'vesper'];

export const SETTINGS = [
  { id: 'sidebar_start_collapsed', section: 'ui', type: 'bool', default: false, label: 'Start with the side panel collapsed', hint: 'Takes effect the next time Herdr opens. F12 then b toggles it any time.' },
  { id: 'sidebar_collapsed_mode', section: 'ui', type: 'enum', default: 'compact', choices: ['compact', 'hidden'], label: 'When collapsed, show', hint: 'compact = a thin status strip; hidden = nothing at all.' },
  { id: 'hide_tab_bar_when_single_tab', section: 'ui', type: 'bool', default: false, label: 'Hide the tab row when there is one tab', hint: 'Turn off to always see the tab row and its new-tab button.' },
  { id: 'confirm_close', section: 'ui', type: 'bool', default: true, label: 'Ask before closing a workspace', hint: '' },
  { id: 'prompt_new_tab_name', section: 'ui', type: 'bool', default: true, label: 'Ask for a name when making a tab', hint: 'Off = tabs are created instantly.' },
  { id: 'accent', section: 'ui', type: 'color', default: '#00ffff', label: 'Accent colour', hint: 'Highlights and borders, e.g. #c6a86e.' },
  { id: 'name', section: 'theme', type: 'enum', default: 'catppuccin', choices: THEMES, label: 'Theme', hint: '' },
];

const byKey = (section, id) => SETTINGS.find((s) => s.section === section && s.id === id);
const slot = (s) => `${s.section}.${s.id}`;

const render = (s, v) => (s.type === 'bool' ? String(v) : `"${v}"`);

/** Return an error string for a value that does not fit its setting, else null. */
function invalid(s, v) {
  if (s.type === 'bool') return typeof v === 'boolean' ? null : 'must be true or false';
  if (s.type === 'enum') return s.choices.includes(v) ? null : `must be one of ${s.choices.join(', ')}`;
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'must look like #rrggbb';
}

/** Current value of every allowed setting in the toml text (undefined = not set, Herdr default applies). */
export function readSettings(text) {
  const values = {};
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (head) { section = head[1].trim(); continue; }
    const kv = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*(#.*)?$/);
    const s = kv && byKey(section, kv[1]);
    if (!s) continue;
    const raw = kv[2];
    values[slot(s)] = s.type === 'bool' ? raw === 'true' : raw.replace(/^"|"$/g, '');
  }
  return values;
}

/**
 * Apply { "ui.accent": "#c6a86e", ... } to the toml text and return the new text.
 * Throws on an unknown setting or a value that does not fit, before touching anything.
 */
export function patchSettings(text, changes) {
  const todo = Object.entries(changes).map(([k, v]) => {
    const [section, id] = k.split('.');
    const s = byKey(section, id);
    if (!s) throw new Error(`Unknown setting: ${k}`);
    const why = invalid(s, v);
    if (why) throw new Error(`${k} ${why}`);
    return { s, line: `${s.id} = ${render(s, v)}` };
  });

  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  for (const { s, line } of todo) {
    const head = lines.findIndex((l) => l.trim() === `[${s.section}]`);
    if (head === -1) {
      if (lines.at(-1) !== '') lines.push('');
      lines.push(`[${s.section}]`, line, '');
      continue;
    }
    let end = lines.findIndex((l, i) => i > head && /^\s*\[/.test(l));
    if (end === -1) end = lines.length;
    const at = lines.findIndex((l, i) => i > head && i < end && new RegExp(`^\\s*${s.id}\\s*=`).test(l));
    if (at !== -1) lines[at] = line;
    else lines.splice(head + 1, 0, line);
  }
  return lines.join(nl);
}
