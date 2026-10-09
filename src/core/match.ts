// Сопоставление по имени (этап 1б): чужой компонент → наш компонент или набор с тем же именем.
// Без Figma API. Часть движка замены: зависит только от src/core.
//
// Одно имя бывает у нескольких наших компонентов (в Driver: `default`, `big`, `small`, `Tabs`…) —
// тогда выбираем по размеру (правило 27 скилла: проверять назначение, а не только имя), а если размер
// не разводит — решает дизайнер.

import type { LibraryIndex, LibraryKind } from './library-index';

/** Допуск по размеру: ±20 % по каждой стороне (как в скилле, Шаг 05b). */
export const SIZE_TOLERANCE = 0.2;

/**
 * Имя для сравнения: без регистра, без эмодзи и знаков в начале (`🔷 push`, `.base`, ` StatusInfo`),
 * пробелы вокруг `/` убраны, повторные пробелы схлопнуты.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Size {
  width: number;
  height: number;
}

/** Наш компонент-кандидат: набор целиком или одиночный компонент. */
export interface Candidate {
  /** Ключ набора или компонента для импорта. */
  key: string;
  isSet: boolean;
  name: string;
  libraryId: string;
  product: string;
  kind: LibraryKind;
  /** Размеры вариантов набора (у одиночного — один). */
  sizes: Size[];
}

/** Имя → кандидаты из всех индексов. */
export function buildCandidates(indexes: readonly LibraryIndex[]): Map<string, Candidate[]> {
  const byName = new Map<string, Candidate[]>();
  const push = (c: Candidate) => {
    const key = normalizeName(c.name);
    if (!key) return;
    const list = byName.get(key) ?? [];
    list.push(c);
    byName.set(key, list);
  };
  for (const index of indexes) {
    const base = { libraryId: index.libraryId, product: index.product, kind: index.kind };
    const setSizes = new Map<string, Size[]>();
    for (const e of index.entries) {
      if (e.setKey) {
        const list = setSizes.get(e.setKey) ?? [];
        list.push({ width: e.width, height: e.height });
        setSizes.set(e.setKey, list);
      } else push({ ...base, key: e.key, isSet: false, name: e.name, sizes: [{ width: e.width, height: e.height }] });
    }
    for (const set of index.sets) push({ ...base, key: set.key, isSet: true, name: set.name, sizes: setSizes.get(set.key) ?? [] });
  }
  return byName;
}

/** Насколько размеры расходятся: 0 — совпали; 0.2 — сторона отличается на 20 %. Ближайший вариант набора. */
export function sizeDistance(size: Size, candidate: Candidate): number {
  const side = (a: number, b: number) => (Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b));
  let best = Infinity;
  for (const s of candidate.sizes) best = Math.min(best, Math.max(side(size.width, s.width), side(size.height, s.height)));
  return best;
}

/**
 * - `exact` — один подходящий кандидат по имени и размеру (или размер развёл одноимённых);
 * - `size` — имя совпало, размер нет: проверить назначение (правило 27);
 * - `ambiguous` — несколько одноимённых, размер не разводит: выбор дизайнера;
 * - `none` — по имени не нашлось.
 */
export type MatchStatus = 'exact' | 'size' | 'ambiguous' | 'none';

export interface MatchResult {
  status: MatchStatus;
  /** Предложенный кандидат (у `ambiguous` и `none` — нет). */
  target?: Candidate;
  /** Все одноимённые кандидаты продукта — ближайшие по размеру первыми. */
  alternatives: Candidate[];
}

export function matchByName(name: string, size: Size, byName: ReadonlyMap<string, Candidate[]>, product?: string): MatchResult {
  const all = byName.get(normalizeName(name)) ?? [];
  const list = all
    .filter((c) => !product || c.product === product)
    .map((c) => ({ c, d: sizeDistance(size, c) }))
    .sort((a, b) => a.d - b.d);
  const alternatives = list.map((x) => x.c);
  if (!list.length) return { status: 'none', alternatives };
  const fits = list.filter((x) => x.d <= SIZE_TOLERANCE);
  if (list.length === 1) return { status: fits.length ? 'exact' : 'size', target: list[0].c, alternatives };
  if (fits.length === 1) return { status: 'exact', target: fits[0].c, alternatives };
  return { status: 'ambiguous', alternatives };
}

/**
 * Продукт макета: тот, у которого больше мест нашли пару по имени. Driver и Rider — разные продукты
 * с похожими именами; в одном макете их не смешиваем.
 */
export function guessProduct(groups: readonly { name: string; count: number }[], byName: ReadonlyMap<string, Candidate[]>): string | undefined {
  const score = new Map<string, number>();
  for (const g of groups) {
    const products = new Set((byName.get(normalizeName(g.name)) ?? []).map((c) => c.product));
    for (const p of products) score.set(p, (score.get(p) ?? 0) + g.count);
  }
  let best: string | undefined;
  for (const [p, n] of score) if (!best || n > (score.get(best) ?? 0)) best = p;
  return best;
}
