// The Terminal page: change how Herdr itself looks and behaves, with switches instead of a text file.
// Every control saves the instant you touch it. The rules for what may change live on the server
// (src/herdrsettings.mjs); this file only draws the list it is given.
import { esc, get, post } from './ui.js';

const closeSettings = () => { document.querySelector('.settings-overlay')?.remove(); };

function control(s, value) {
  const v = value ?? s.default;
  const name = `${s.section}.${s.id}`;
  if (s.type === 'bool') {
    return `<label class="set-switch"><input type="checkbox" data-key="${name}" ${v ? 'checked' : ''} />
      <span>${v ? 'On' : 'Off'}</span></label>`;
  }
  if (s.type === 'enum') {
    return `<select data-key="${name}">${s.choices.map((c) =>
      `<option value="${esc(c)}" ${c === v ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  }
  return `<input type="color" data-key="${name}" value="${esc(v)}" />`;
}

function row(s, value) {
  const usingDefault = value === undefined;
  return `<div class="set-row">
    <div class="set-text"><strong>${esc(s.label)}</strong>
      <small>${esc(s.hint)}${usingDefault ? ' (Herdr default)' : ''}</small></div>
    <div class="set-control">${control(s, value)}</div>
  </div>`;
}

export async function openSettings() {
  closeSettings();
  const r = await get('/api/terminal/settings');
  const ov = document.createElement('div');
  ov.className = 'overlay settings-overlay';
  ov.innerHTML = `<div class="sheet settings">
    <div class="sheet-head">
      <h3 class="display">Terminal</h3>
      <div class="actions">
        <span class="flow-msg set-msg" role="status" aria-live="polite"></span>
        <button class="btn" data-act="close">Close</button>
      </div>
    </div>
    <p class="muted-note">How Herdr itself looks and behaves. Changes save at once and Herdr picks
      them up without restarting. Your old settings file is kept as a dated copy beside it.</p>
    <div class="set-list">${r.ok ? r.settings.map((s) => row(s, r.values[`${s.section}.${s.id}`])).join('')
      : `<p class="muted-note">Could not read Herdr's settings: ${esc(r.error)}</p>`}</div>
  </div>`;
  document.body.appendChild(ov);

  const msg = ov.querySelector('.set-msg');
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-act="close"]')) closeSettings(); });
  ov.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    msg.textContent = 'Saving…';
    const res = await post('/api/terminal/settings', { changes: { [el.dataset.key]: value } });
    if (!res.ok) { msg.textContent = res.error; return; }
    if (el.type === 'checkbox') el.nextElementSibling.textContent = value ? 'On' : 'Off';
    msg.textContent = res.diagnostics?.length ? `Saved, but Herdr says: ${res.diagnostics.join('; ')}` : 'Saved — Herdr updated';
  });
}
