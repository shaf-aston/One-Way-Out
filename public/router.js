// Pure core: the address bar is the app's state. One place decides what a URL means.
//
// Board, Connections and Workflows are places — each has its own link you can bookmark,
// reload into, and step back out of with the browser's own Back button. The agent viewer
// is not a place: it is a quick look at one agent, so it rides on top of whatever view you
// are in and leaves no history entry behind.

/** `#/board/abc` -> { view:'board', arg:'abc' }. Anything unknown falls back to sessions. */
export function parseHash(hash, views) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = parts[0] ?? '';
  if (!views.includes(view)) return { view: 'sessions', arg: null };
  // A hand-mangled address must not crash the router — undecodable text is kept as-is.
  let arg = parts[1] ?? null;
  if (arg) { try { arg = decodeURIComponent(arg); } catch { /* keep the raw text */ } }
  return { view, arg };
}

/** The link for a view — the single place a URL is spelled, so nothing hand-writes one. */
export const linkTo = (view, arg = null) =>
  (view === 'sessions' ? '#/' : `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ''}`);

/**
 * Watch the address bar. `onRoute` is called once now and on every change after.
 * @param {string[]} views - the view names this app answers to
 * @param {(route:{view:string,arg:string|null}) => void} onRoute
 */
export function startRouter(views, onRoute) {
  const fire = () => onRoute(parseHash(window.location.hash, views));
  window.addEventListener('hashchange', fire);
  fire();
}

/** Change the address bar, which is what actually triggers the view change. */
export const go = (view, arg = null) => { window.location.hash = linkTo(view, arg); };
