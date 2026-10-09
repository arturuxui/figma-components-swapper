// Составные компоненты (этап 2в, правило 32 скилла): фрейм со своим оформлением, внутри которого лежат компоненты, —
// это может быть наш составной компонент под другим именем. Пример из скилла: фрейм `Booster` (заливка + экземпляр
// `booster`) → набор `Booster Section`; в Driver: фрейм `balance panel/1. three items` (три `balance`) → `bar/button`.
// Без Figma API. Часть движка замены.
//
// Главный признак — те же вложенные компоненты (по имени). Точность важнее полноты: только предложение с примеркой,
// размер — как у варианта (±20 %), устройство похоже не меньше, чем у «Имя и устройство» (2б).

import type { ManualFinding } from './manual';
import { normalizeName, sizeDistance, SIZE_TOLERANCE, type Candidate, type MatchResult } from './match';
import { structureScore, type Shape } from './structure';

/** Устройство фрейма и варианта похоже хотя бы настолько (как NAMED_MIN в 2б). */
export const COMPOSITE_MIN = 0.7;
/** Общие вложенные компоненты — хотя бы такая доля от большего списка (`wide` из `wide+wide` — да, 1 из 3 — нет). */
export const COMPOSITE_PARTS_MIN = 0.5;
/** Суффиксы составных компонентов (скилл, Шаг 05b, 3b): `Booster` → `Booster Section`. Только для порядка в списке. */
export const COMPOSITE_SUFFIXES = ['section', 'bar', 'banner', 'card', 'block', 'container', 'widget', 'panel'];

/**
 * Доля общих вложенных компонентов, если все компоненты фрейма есть в варианте (с повторами); иначе 0 —
 * компонент фрейма, которого в нашем нет, при замене потерялся бы.
 */
export function partsCover(frame: readonly string[], variant: readonly string[]): number {
  if (!frame.length) return 0;
  const pool = variant.map(normalizeName);
  for (const p of frame) {
    const i = pool.indexOf(normalizeName(p));
    if (i < 0) return 0;
    pool.splice(i, 1);
  }
  return frame.length / Math.max(frame.length, variant.length);
}

/** Имя нашего — имя фрейма с суффиксом составного (`Booster` → `Booster Section`) или наоборот. */
export function suffixName(frame: string, ours: string): boolean {
  const a = normalizeName(frame);
  const b = normalizeName(ours);
  if (!a || !b || a === b) return false;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return COMPOSITE_SUFFIXES.some((s) => long === `${short} ${s}` || long === `${short}/${s}`);
}

/** Лучший подходящий вариант кандидата: размер ±20 %, все вложенные компоненты фрейма есть, устройство похоже. */
function bestVariant(f: ManualFinding, c: Candidate): number {
  const shapes = c.isSet ? (c.variants ?? []).map((v) => v.shape) : [c.shape];
  let best = -1;
  for (const s of shapes) {
    if (!s || sizeDistance(f, { ...c, sizes: [s] }) > SIZE_TOLERANCE) continue;
    if (partsCover(f.shape.parts, s.parts) < COMPOSITE_PARTS_MIN) continue;
    best = Math.max(best, structureScore(f.shape, s as Shape));
  }
  return best;
}

/**
 * Пара для фрейма со своим оформлением и вложенными компонентами — наш составной компонент (`composite`) или `none`.
 * Иконки не предлагаются. Порядок: сначала имя с суффиксом составного, потом похожесть устройства.
 */
export function matchComposite(f: ManualFinding, byName: ReadonlyMap<string, Candidate[]>, product?: string): MatchResult {
  if (!f.visual || !f.shape.parts.length) return { status: 'none', alternatives: [] };
  const found: { c: Candidate; s: number; named: boolean }[] = [];
  for (const list of byName.values()) {
    for (const c of list) {
      if ((product && c.product !== product) || c.kind === 'icons') continue;
      const s = bestVariant(f, c);
      if (s >= COMPOSITE_MIN) found.push({ c, s, named: suffixName(f.name, c.name) });
    }
  }
  if (!found.length) return { status: 'none', alternatives: [] };
  found.sort((a, b) => Number(b.named) - Number(a.named) || b.s - a.s);
  return { status: 'composite', target: found[0].c, alternatives: found.map((x) => x.c), score: found[0].s };
}
