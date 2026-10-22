// Карта переименований с сервера Library Updater (AID-LU-18). Хранится в `clientStorage` вместе с курсором:
// при скане подгружается только новое. Сервер недоступен — работаем по сохранённому (или без карты), скан не падает.

import { mergeRenames, parseRenames, type RenameEntry } from '../core/renames';

export const RENAMES_SERVER = 'https://library-updater.wb-aid-lu.workers.dev';
/** Дольше не ждём: скан не должен зависать из-за сети. */
const TIMEOUT_MS = 5000;

interface Cached {
  cursor: string | null;
  entries: RenameEntry[];
}

const KEY = (libraryId: string) => `renames:${libraryId}`;

export interface LoadedRenames {
  entries: RenameEntry[];
  /** Библиотеки, по которым сервер не ответил (взяли сохранённое). */
  offline: string[];
}

async function fetchJson(url: string): Promise<unknown> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS));
  const res = await Promise.race([fetch(url, { headers: { 'X-Figma-User-Id': figma.currentUser?.id ?? '' } }), timeout]);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadRenames(libraryIds: readonly string[]): Promise<LoadedRenames> {
  const out: LoadedRenames = { entries: [], offline: [] };
  for (const id of libraryIds) {
    const cached = ((await figma.clientStorage.getAsync(KEY(id))) as Cached | undefined) ?? { cursor: null, entries: [] };
    try {
      const since = cached.cursor ? `?since=${encodeURIComponent(cached.cursor)}` : '';
      const fresh = parseRenames(await fetchJson(`${RENAMES_SERVER}/libraries/${encodeURIComponent(id)}/renames${since}`));
      const next: Cached = { cursor: fresh.cursor ?? cached.cursor, entries: mergeRenames(cached.entries, fresh.entries) };
      await figma.clientStorage.setAsync(KEY(id), next);
      out.entries.push(...next.entries);
    } catch {
      out.offline.push(id);
      out.entries.push(...cached.entries);
    }
  }
  return out;
}
