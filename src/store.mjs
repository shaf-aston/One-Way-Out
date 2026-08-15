// One tiny JSON-file store, shared by workflows and teams.
// A record's id IS its file name, so ids stay a strict slug — no paths, no traversal.
import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isValidId } from './ids.mjs';

async function readOne(dir, file) {
  try {
    const record = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    const id = file.slice(0, -5);
    return isValidId(id) && record?.name ? { ...record, id } : null;
  } catch { return null; }
}

/** Everything saved in `dir`, by name, ignoring anything unreadable. */
export async function list(dir) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
  const all = (await Promise.all(files.map((f) => readOne(dir, f)))).filter(Boolean);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function save(dir, record) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function remove(dir, id) {
  if (!isValidId(id)) throw new Error('Bad id');
  await unlink(path.join(dir, `${id}.json`));
}
