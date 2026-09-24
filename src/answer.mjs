// Service layer: press a menu choice in a running agent, looking at the screen the whole way.
// Knows nothing about HTTP or the UI, and talks to Herdr only through the swap-seam.
//
// Why this exists at all. Answering a menu used to be a fixed list of key presses worked out
// in advance: Up (total − 1) times to "park at the top", then Down (n − 1) times, then Enter.
// Measured on a live Claude Code menu on 2026-09-01, that is wrong — **the highlight wraps**,
// so one Up from the top row lands on the bottom row. The fixed list lands on
// ((start + n − total − 1) mod total) + 1, a different row depending on where the highlight
// already happened to be. On the trust prompt it chose "No, exit" and the agent quit; on the
// three-option resume prompt it turns a click on "Resume from summary" into "Resume the full
// session", which is the expensive one.
//
// So nothing here is worked out in advance. One press, look, decide again — and Enter only
// when the agent's own screen says the highlight is on the row that was asked for.
import { readPane, sendKeys } from './herdr.mjs';
import { nextPress } from '../public/menu.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Walk one agent's menu to the answer whose words match `wanted`, and press Enter there.
 *
 * @param {string} bin - the Herdr binary
 * @param {string} paneId - the agent to answer
 * @param {RegExp} wanted - matches the label of the row to land on
 * @param {{maxPresses?:number, settleMs?:number}} [opts]
 * @returns {Promise<{ok:true,label:string,presses:number}|{ok:false,error:string,presses:number}>}
 */
export async function answerMenu(bin, paneId, wanted, opts = {}) {
  const maxPresses = opts.maxPresses ?? 24;
  const settleMs = opts.settleMs ?? 350;
  let presses = 0;
  for (let i = 0; i <= maxPresses; i += 1) {
    let screen;
    try { screen = await readPane(bin, paneId, 'text'); }
    catch (e) { return { ok: false, error: `Could not read that agent: ${e.message || e}`, presses }; }

    const step = nextPress(screen, wanted);
    if (step.do === 'stop') return { ok: false, error: step.why, presses };
    try { await sendKeys(bin, paneId, step.do); } catch (e) {
      return { ok: false, error: `Herdr would not press ${step.do}: ${e.message || e}`, presses };
    }
    presses += 1;
    if (step.do === 'enter') return { ok: true, label: step.label, presses };
    // The screen needs a moment to redraw, or the next read shows the highlight where it was.
    await sleep(settleMs);
  }
  // Never fall through to an Enter: giving up is the safe end, pressing on a guess is not.
  return { ok: false, error: 'The highlight never reached that answer, so nothing was confirmed.', presses };
}
