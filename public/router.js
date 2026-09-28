// Pure core: the address bar is the app's state. One place decides what a URL means.
//
// Every page — Dashboard, Issues, Org and the rest — is a place with its own link you can
// bookmark, reload into, and step back out of with the browser's own Back button. The agent
// viewer is not a place: it is a quick look at one agent, so it rides on top of whatever page
// you are on and leaves no history entry behind.

/** The page `#/` means. */
export const HOME = 'dashboard';

/** `#/issues/acme-3` -> { view:'issues', arg:'acme-3' }. Anything unknown falls back to home. */
export function parseHash(hash, views) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = parts[0] ?? '';
  if (!views.includes(view)) return { view: HOME, arg: null };
  // A hand-mangled address must not crash the router — undecodable text is kept as-is.
  let arg = parts[1] ?? null;
  if (arg) { try { arg = decodeURIComponent(arg); } catch { /* keep the raw text */ } }
  return { view, arg };
}

/** The link for a page — the single place a URL is spelled, so nothing hand-writes one. */
export const linkTo = (view, arg = null) =>
  (view === HOME && !arg ? '#/' : `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ''}`);

/**
 * Watch the address bar. `onRoute` is called once now and on every change after.
 * @param {string[]} views - the page names this app answers to
 * @param {(route:{view:string,arg:string|null}) => void} onRoute
 */
export function startRouter(views, onRoute) {
  const fire = () => onRoute(parseHash(window.location.hash, views));
  window.addEventListener('hashchange', fire);
  fire();
}

/** Change the address bar, which is what actually triggers the page change. */
export const go = (view, arg = null) => { window.location.hash = linkTo(view, arg); };
