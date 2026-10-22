// Карта переименований библиотек (AID-LU-18) от сервера Library Updater: при каждой публикации он сравнивает
// опубликованное по ключу — тот же ключ с другим именем — переименование, пропал — удаление, новый — добавление.
// Контракт: GET /libraries/<id>/renames?since=<ISO> → { entries, cursor } (PR arturuxui/figma-library-updater#41).
// Без Figma API. Часть движка замены: зависит только от src/core.

import type { LibraryIndex } from './library-index';

export type RenameKind = 'variable' | 'style' | 'component' | 'component_set';

interface RenameTarget {
  kind: RenameKind;
  key: string;
  /** Только у вариантов набора: переименование варианта — смена значения оси. */
  setKey?: string;
  setName?: string;
}

export interface RenameEntry {
  id: string;
  libraryId: string;
  fileKey: string;
  publishedAt: string;
  by?: string;
  description?: string;
  renamed: (RenameTarget & { from: string; to: string })[];
  deleted: (RenameTarget & { name: string })[];
  added: (RenameTarget & { name: string })[];
}

export interface RenamesResponse {
  entries: RenameEntry[];
  /** `publishedAt` последней записи — `since` следующего запроса. */
  cursor: string | null;
}

/** Ответ сервера → проверенный ответ: чужое и битое отбрасываем, а не падаем. */
export function parseRenames(json: unknown): RenamesResponse {
  const r = json as Partial<RenamesResponse> | null;
  const list = Array.isArray(r?.entries) ? r!.entries : [];
  const keyed = <T extends { key?: unknown }>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]).filter((x) => !!x && typeof x.key === 'string') : []);
  const entries: RenameEntry[] = list
    .filter((e): e is RenameEntry => !!e && typeof e.id === 'string' && typeof e.publishedAt === 'string')
    .map((e) => ({ ...e, renamed: keyed<RenameEntry['renamed'][number]>(e.renamed), deleted: keyed<RenameEntry['deleted'][number]>(e.deleted), added: keyed<RenameEntry['added'][number]>(e.added) }));
  return { entries, cursor: typeof r?.cursor === 'string' ? r.cursor : null };
}

/** Сохранённое + новое: без повторов по id, по возрастанию даты публикации. */
export function mergeRenames(cached: readonly RenameEntry[], fresh: readonly RenameEntry[]): RenameEntry[] {
  const byId = new Map<string, RenameEntry>();
  for (const e of [...cached, ...fresh]) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

const isNamed = (t: RenameTarget) => (t.kind === 'component' && !t.setKey) || t.kind === 'component_set';

/**
 * Все имена, которые были у компонента или набора: ключ → имена. Старое имя в макете («ic_add_circle») найдёт наш
 * компонент под новым («ic_add_circle_fill»), и наоборот — если индекс собран до переименования.
 * Варианты наборов не берём: их «имя» — значения осей, а не имя компонента.
 */
export function renameAliases(entries: readonly RenameEntry[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const e of entries)
    for (const r of e.renamed) {
      if (!isNamed(r)) continue;
      const names = out.get(r.key) ?? new Set<string>();
      names.add(r.from);
      names.add(r.to);
      out.set(r.key, names);
    }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

export interface RenameStaleness {
  /** Ключи, удалённые из библиотеки после сборки индекса, — из подбора убираются. */
  removed: Set<string>;
  /** Их имена — для предупреждения. */
  removedNames: string[];
  /** Сколько добавлено после сборки индекса — их видно только после пересборки. */
  added: number;
}

/** Что изменилось в библиотеке после сборки её индекса (по дате публикации). */
export function staleness(entries: readonly RenameEntry[], indexes: readonly Pick<LibraryIndex, 'libraryId' | 'fileKey' | 'takenAt'>[]): RenameStaleness {
  const out: RenameStaleness = { removed: new Set(), removedNames: [], added: 0 };
  for (const e of entries) {
    const index = indexes.find((i) => i.libraryId === e.libraryId || (!!i.fileKey && i.fileKey === e.fileKey));
    if (!index || e.publishedAt <= index.takenAt) continue;
    for (const d of e.deleted) {
      if (d.kind !== 'component' && d.kind !== 'component_set') continue;
      out.removed.add(d.key);
      if (isNamed(d)) out.removedNames.push(d.name);
    }
    out.added += e.added.filter((a) => a.kind === 'component_set' || (a.kind === 'component' && !a.setKey)).length;
  }
  return out;
}
