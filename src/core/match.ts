// Сопоставление по имени (этап 1б): чужой компонент → наш компонент или набор с тем же именем.
// Без Figma API. Часть движка замены: зависит только от src/core.
//
// Одно имя бывает у нескольких наших компонентов (в Driver: `default`, `big`, `small`, `Tabs`…) —
// тогда выбираем по размеру (правило 27 скилла: проверять назначение, а не только имя), а если размер
// не разводит — решает дизайнер.

import { aliasesOf } from './aliases';
import { ICON_SIMILAR, ICON_SURE, iconSimilarity, rankIcons, unpackPrint, type IconPrint } from './icon-shape';
import type { LibraryIndex, LibraryKind } from './library-index';
import type { Shape } from './structure';

/** Допуск по размеру: ±20 % по каждой стороне (как в скилле, Шаг 05b). */
export const SIZE_TOLERANCE = 0.2;
/** Растянут: высота совпала с вариантом с такой точностью, px. */
export const STRETCH_HEIGHT_PX = 1;
/** Растянут: только горизонтальные компоненты (строки, полосы) — ширина не меньше стольких высот. */
export const STRETCH_MIN_ASPECT = 3;

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
  /** Варианты набора — чтобы дизайнер мог выбрать вариант сам (у отвязанных фреймов). */
  variants?: { key: string; name: string; shape?: Shape }[];
  /** Устройство одиночного компонента (этап 2б). */
  shape?: Shape;
  /** Иконка: отпечаток рисунка (этап 3). Подбор по рисунку обновляет его по актуальной версии из библиотеки. */
  icon?: { print: IconPrint; glyph?: { width: number; height: number }; multicolor?: boolean };
}

/**
 * Что заменять по выбранному ключу: ключ кандидата (набор целиком — вариант подберёт плагин) или ключ одного
 * из его вариантов (выбран дизайнером). Нет такого ключа — null.
 */
export function resolveChoice(alternatives: readonly Candidate[], key: string): { owner: Candidate; target: { key: string; isSet: boolean } } | null {
  for (const c of alternatives) {
    if (c.key === key) return { owner: c, target: { key: c.key, isSet: c.isSet } };
    if (c.variants?.some((v) => v.key === key)) return { owner: c, target: { key, isSet: false } };
  }
  return null;
}

/** Имя → кандидаты из всех индексов; наш компонент лежит и под старыми именами из известных пар. */
export function buildCandidates(indexes: readonly LibraryIndex[]): Map<string, Candidate[]> {
  const byName = new Map<string, Candidate[]>();
  const add = (key: string, c: Candidate) => {
    if (!key) return;
    const list = byName.get(key) ?? [];
    list.push(c);
    byName.set(key, list);
  };
  // Свой ключ и старые имена из известных пар (`aliases.ts`).
  const push = (c: Candidate) => {
    add(normalizeName(c.name), c);
    for (const old of aliasesOf(c.product, c.name, normalizeName)) add(normalizeName(old), c);
  };
  for (const index of indexes) {
    const base = { libraryId: index.libraryId, product: index.product, kind: index.kind };
    const setSizes = new Map<string, Size[]>();
    const setVariants = new Map<string, { key: string; name: string; shape?: Shape }[]>();
    for (const e of index.entries) {
      if (e.setKey) {
        const list = setSizes.get(e.setKey) ?? [];
        list.push({ width: e.width, height: e.height });
        setSizes.set(e.setKey, list);
        const variants = setVariants.get(e.setKey) ?? [];
        variants.push({ key: e.key, name: e.name, shape: e.shape && { ...e.shape, width: e.width, height: e.height } });
        setVariants.set(e.setKey, variants);
      } else
        push({
          ...base,
          key: e.key,
          isSet: false,
          name: e.name,
          sizes: [{ width: e.width, height: e.height }],
          shape: e.shape && { ...e.shape, width: e.width, height: e.height },
          icon: e.icon && { print: unpackPrint(e.icon.print), glyph: e.icon.glyph, multicolor: e.icon.multicolor },
        });
    }
    for (const set of index.sets) push({ ...base, key: set.key, isSet: true, name: set.name, sizes: setSizes.get(set.key) ?? [], variants: setVariants.get(set.key) ?? [] });
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
 * Растянутый по ширине экземпляр того же компонента: высота совпала с вариантом (±1 px), ширина другая, а сам
 * компонент горизонтальный (строка, полоса). То, что экземпляр можно растянуть, ещё не значит, что это пара,
 * поэтому условия узкие: высота — точно, только ширина, только горизонтальные компоненты. Выросшая высота
 * (другой контент, другой вариант) сюда не попадает.
 */
export function isWidthStretch(size: Size, candidate: Candidate): boolean {
  return candidate.sizes.some(
    (s) => s.height > 0 && s.width >= STRETCH_MIN_ASPECT * s.height && Math.abs(size.height - s.height) <= STRETCH_HEIGHT_PX && Math.abs(size.width - s.width) > STRETCH_HEIGHT_PX,
  );
}

/**
 * - `exact` — один подходящий кандидат по имени и размеру (или размер развёл одноимённых);
 * - `stretched` — один кандидат по имени, экземпляр растянут по ширине (`isWidthStretch`);
 * - `size` — имя совпало, размер нет: проверить назначение (правило 27);
 * - `ambiguous` — несколько одноимённых, размер не разводит: выбор дизайнера;
 * - `none` — по имени не нашлось;
 * - `drawn` / `shape` — иконка по рисунку (этап 3): тот же рисунок (замена без вопроса) / похожий (решает дизайнер).
 */
export type MatchStatus = 'exact' | 'stretched' | 'size' | 'ambiguous' | 'none' | 'named' | 'similar' | 'composite' | 'drawn' | 'shape';

export interface MatchResult {
  status: MatchStatus;
  /** Похожесть устройства, 0..1 — у ручных фреймов (`named`, `similar`). */
  score?: number;
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
  if (list.length === 1) {
    const only = list[0].c;
    // Одноимённых нет: растянутый по ширине — тоже пара. Среди одноимённых растяжением не разводим.
    const status = fits.length ? 'exact' : isWidthStretch(size, only) ? 'stretched' : 'size';
    return { status, target: only, alternatives };
  }
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

/** Иконка макета для подбора по рисунку. */
export interface LayoutIcon {
  print: IconPrint;
  glyph?: { width: number; height: number };
  multicolor: boolean;
  name: string;
}

/** Иконки продукта с отпечатком — с ними сравнивается рисунок. */
export function iconCandidates(byName: ReadonlyMap<string, Candidate[]>, product?: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const list of byName.values()) for (const c of list) {
    if (c.kind !== 'icons' || !c.icon || seen.has(c.key) || (product && c.product !== product)) continue;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

/**
 * Наша иконка по рисунку (этап 3). `drawn` — тот же рисунок и выбор однозначен; `shape` — похожий, в списке
 * ближайшие по рисунку: решает дизайнер.
 */
export function matchIcon(layout: LayoutIcon, candidates: readonly Candidate[]): MatchResult {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const m = rankIcons(
    layout.print,
    candidates.map((c) => ({ key: c.key, name: c.name, print: c.icon!.print, glyph: c.icon!.glyph, multicolor: c.icon!.multicolor })),
    { name: layout.name, glyph: layout.glyph, multicolor: layout.multicolor },
  );
  const alternatives = m.nearest.filter((n) => n.similarity >= ICON_SIMILAR - 0.1).map((n) => byKey.get(n.candidate.key)!);
  if (m.status === 'none' || !m.target) return { status: 'none', alternatives };
  const target = byKey.get(m.target.key)!;
  // Многоцветная (своя или наша): цвета — часть рисунка, по одному силуэту не решаем (замер: кольцо адреса
  // и цветная монета совпали силуэтом на 100 %) — только предложение.
  const sure = m.similarity >= ICON_SURE && !m.disputed && !layout.multicolor && !target.icon?.multicolor;
  return { status: sure ? 'drawn' : 'shape', target, score: m.similarity, alternatives: [target, ...alternatives.filter((c) => c.key !== target.key)] };
}

/** Тот же ли рисунок у иконки в индексе и у её актуальной версии из библиотеки. */
export const samePrint = (a: IconPrint, b: IconPrint) => iconSimilarity(a, b, 0) >= 0.98;
