// The three id rules the whole app shares. Pure, no I/O — imported by core and transport alike
// so a pane id or a file name is judged the same way everywhere.

/** Herdr pane/terminal ids, e.g. "w2:p1". */
export const isValidPaneId = (id) => typeof id === 'string' && /^[\w:.-]{1,64}$/.test(id);

/** Saved-record ids double as file names, so they stay a strict slug — no paths, no traversal. */
export const isValidId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/.test(id);

/** "Review then fix" -> "review-then-fix". Same name = same id = a deliberate overwrite. */
export const slugify = (name) =>
  String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 49);
