// Индекс библиотеки WB AID: какие компоненты и иконки в ней есть. Без Figma API — тестируется в vitest.
//
// Plugin API не перечисляет компоненты подключённой библиотеки, поэтому индекс собирает сам плагин,
// запущенный в файле библиотеки, а в макете использует сохранённый. Этот модуль — формат индекса
// и поиск по нему; модуль замены (будущий движок) зависит только от него, а не от UI и конфига.

export type LibraryKind = 'components' | 'icons';

import type { Shape } from './structure';

/** Версия формата: меняется — старые индексы пересобираются. /2 — устройство вариантов (этап 2б). */
export const INDEX_FORMAT = 'cs-index/2';

export interface IndexEntry {
  /** Ключ компонента для `importComponentByKeyAsync`. */
  key: string;
  /** Имя компонента; у варианта — «Size=M, State=Default». */
  name: string;
  setKey?: string;
  setName?: string;
  /** Значения осей варианта. */
  variant?: Record<string, string>;
  width: number;
  height: number;
  /** Страница библиотеки — для подсказок в отчёте. */
  page: string;
  /** Устройство (без размера — он выше): с чем сравнивать ручные фреймы макета. */
  shape?: Omit<Shape, 'width' | 'height'>;
}

export interface IndexSet {
  key: string;
  name: string;
  /** Ось → допустимые значения. */
  axes: Record<string, string[]>;
  variants: number;
}

export interface LibraryIndex {
  format: typeof INDEX_FORMAT;
  libraryId: string;
  product: string;
  kind: LibraryKind;
  fileKey: string;
  /** ISO-время сборки. */
  takenAt: string;
  entries: IndexEntry[];
  sets: IndexSet[];
}

/** Коротко для окна плагина: что лежит в индексе. */
export interface IndexSummary {
  libraryId: string;
  takenAt: string;
  components: number;
  sets: number;
}

export const summarizeIndex = (index: LibraryIndex): IndexSummary => ({
  libraryId: index.libraryId,
  takenAt: index.takenAt,
  components: index.entries.length,
  sets: index.sets.length,
});

/** Компонент с именем на `.` или `_` в Figma не публикуется — в индекс не берём. */
export const isPrivateName = (name: string) => /^\s*[._]/.test(name);

/** «Size=M, State=Default» → { Size: 'M', State: 'Default' }. Не вариант — null. */
export function parseVariantName(name: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of name.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const axis = part.slice(0, eq).trim();
    if (!axis) return null;
    out[axis] = part.slice(eq + 1).trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Что известно о ключе из индексов: из какой библиотеки и как называется. */
export interface KeyHit {
  libraryId: string;
  product: string;
  kind: LibraryKind;
  name: string;
}

/** Ключи компонентов и наборов всех индексов — по ним макет делится на «наше» и «чужое». */
export function buildLookup(indexes: readonly LibraryIndex[]): Map<string, KeyHit> {
  const lookup = new Map<string, KeyHit>();
  for (const index of indexes) {
    const hit = (name: string): KeyHit => ({ libraryId: index.libraryId, product: index.product, kind: index.kind, name });
    for (const set of index.sets) lookup.set(set.key, hit(set.name));
    for (const entry of index.entries) lookup.set(entry.key, hit(entry.setName ? `${entry.setName} / ${entry.name}` : entry.name));
  }
  return lookup;
}
