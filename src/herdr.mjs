// Swap-seam: the ONLY module that talks to Herdr. Swap this to change the data source.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Resolve the herdr executable: explicit config path -> default install -> PATH lookup. */
export function resolveHerdrBin(configured) {
  if (configured && existsSync(configured)) return configured;
  const local = process.env.LOCALAPPDATA
    || path.join(os.homedir(), 'AppData', 'Local');
  const win = path.join(local, 'Programs', 'Herdr', 'bin', 'herdr.exe');
  if (existsSync(win)) return win;
  return 'herdr'; // fall back to PATH (macOS/Linux, or a custom install)
}

function run(bin, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout);
    });
  });
}

/**
 * Unwrap one Herdr CLI reply into its `result`.
 * Commands that only *do* something (pane run, pane send-keys) print nothing at all —
 * that silence is success, not a parse failure.
 */
function result(raw, whatFailed) {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  let env;
  try { env = JSON.parse(text); } catch { throw new Error(`${whatFailed}: ${text.slice(0, 200)}`); }
  if (env.error) throw new Error(env.error.message || whatFailed);
  return env.result ?? {};
}

/**
 * Fetch the live session snapshot from Herdr.
 * @returns {Promise<{ok:true, snapshot:object}|{ok:false, error:string}>}
 */
export async function getSnapshot(bin) {
  try {
    const snapshot = result(await run(bin, ['api', 'snapshot']), 'Herdr returned an error').snapshot;
    if (!snapshot) return { ok: false, error: 'Herdr returned an unexpected response shape' };
    return { ok: true, snapshot };
  } catch (e) {
    const msg = String(e.message || e);
    if (/not recognized|ENOENT/i.test(msg)) {
      return { ok: false, error: 'Herdr is not installed or not found.' };
    }
    // Server down / no session yet.
    return { ok: false, error: `Herdr is not running yet. Open Herdr and start an agent. (${msg.split('\n')[0]})` };
  }
}

/**
 * Read a pane's screen text — unwrapped so lines flow to the viewer's full width; falls back
 * to the wrapped visible screen.
 * @param {'text'|'ansi'} format - `ansi` keeps the agent's own colours and bold, which is
 *   what the reader view renders from. Plain `text` is what the workflow runner matches on.
 */
export async function readPane(bin, target, format = 'text') {
  for (const source of ['recent-unwrapped', 'visible']) {
    const raw = await run(bin, ['agent', 'read', target, '--source', source, '--lines', '1000', '--format', format]);
    const text = result(raw, 'Herdr read failed').read?.text ?? '';
    if (text.trim()) return text;
  }
  return '';
}

/** Type text into a pane and press Enter (empty text = just Enter). */
export async function runInPane(bin, paneId, text) {
  result(await run(bin, ['pane', 'run', paneId, text]), 'Herdr send failed');
}

/**
 * The only keys the viewer may press in a pane, and what each one means to Claude Code.
 * A fixed list, not free text — pressing keys in a live terminal is exactly the kind of
 * thing an allow-list should gate, so a bug upstream can never type Ctrl-C into an agent.
 */
export const PANE_KEYS = {
  escape: 'stop what the agent is doing',
  'shift+tab': 'switch the agent\'s working mode',
  enter: 'press Enter',
  up: 'move up a menu',
  down: 'move down a menu',
};

/** Press one allow-listed key in a pane (verified names: enter, escape, shift+tab, up, down). */
export async function sendKeys(bin, paneId, key) {
  if (!(key in PANE_KEYS)) throw new Error(`That key is not allowed: ${key}`);
  result(await run(bin, ['pane', 'send-keys', paneId, key]), 'Herdr key press failed');
}

/** Close a pane — this is how an agent is shut down; Herdr has no separate "kill agent". */
export async function closePane(bin, paneId) {
  result(await run(bin, ['pane', 'close', paneId]), 'Herdr could not close that pane');
}

/** Live state of one agent: {agent_status, cwd, pane_id, ...}. */
export async function getAgent(bin, target) {
  const agent = result(await run(bin, ['agent', 'get', target]), 'Herdr could not read that agent').agent;
  if (!agent) throw new Error('Herdr returned an unexpected agent shape');
  return agent;
}

/**
 * Start a new agent process in its own pane.
 * @param {{label:string, cwd?:string, workspaceId?:string, split?:string, argv:string[]}} spec
 * @returns {Promise<string>} the new pane id.
 */
export async function startAgent(bin, spec) {
  const args = ['agent', 'start', spec.label];
  if (spec.cwd) args.push('--cwd', spec.cwd);
  if (spec.workspaceId) args.push('--workspace', spec.workspaceId);
  if (spec.split) args.push('--split', spec.split);
  args.push('--no-focus', '--', ...spec.argv);
  const raw = await run(bin, args, 20000);
  const paneId = result(raw, 'Herdr could not start that agent').agent?.pane_id;
  if (!paneId) throw new Error('Herdr started the agent but returned no pane id');
  return paneId;
}

/** Bring a pane into focus inside the Herdr terminal UI, then raise the Herdr window itself. */
export async function focusPane(bin, target) {
  result(await run(bin, ['agent', 'focus', target]), 'Herdr focus failed');
  if (process.platform === 'win32') await raiseHerdrWindow();
}

// Focusing a pane only changes selection inside Herdr; without this the browser click looks dead.
const RAISE_PS = `
$sig='[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);';
$W=Add-Type -MemberDefinition $sig -Name Win -Namespace U -PassThru;
$p=Get-Process herdr -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
if($p){ $W::ShowWindow($p.MainWindowHandle,9) | Out-Null; $W::SetForegroundWindow($p.MainWindowHandle) | Out-Null }`;
async function raiseHerdrWindow() {
  try { await run('powershell', ['-NoProfile', '-Command', RAISE_PS], 8000); } catch { /* best effort */ }
}
