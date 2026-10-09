// Ручные фреймы, похожие на наши компоненты (этап 2б, Шаг 05b скилла): фрейм не экземпляр и не отвязан, но
// устроен как наш компонент — ручная копия или пересборка. Без Figma API. Часть движка замены.
//
// Точность важнее полноты: ложная замена хуже пропущенной. Поэтому ручные фреймы только предлагаются (дизайнер
// смотрит примерку и решает), пороги высокие, а без совпавшего имени — только фреймы с собственным оформлением
// (правило 32: чистая обёртка без заливки, обводки и эффектов — это раскладка, а не компонент).

import { matchComposite } from './composite';
import { normalizeName, sizeDistance, SIZE_TOLERANCE, type Candidate, type MatchResult } from './match';
import type { Origin, ReportGroup, ScreenRef } from './scan-report';
import { structureScore, type Shape } from './structure';

/** Имя совпало — устройство должно быть похоже хотя бы настолько. */
export const NAMED_MIN = 0.7;
/** Имени нет — только очень похожее устройство. */
export const SIMILAR_MIN = 0.9;
/** Имени нет — лучший кандидат должен обгонять следующий (другой компонент) хотя бы на столько. */
export const SIMILAR_MARGIN = 0.05;
/**
 * Имени нет — у фрейма должно быть хотя бы столько элементов (тексты, иконки, вложенные компоненты): «таблетка
 * с одним текстом» похожа на всё сразу. На «📍 Order» так совпали подписи-аннотации «Скролл» с кнопкой `default`.
 */
export const SIMILAR_MIN_ELEMENTS = 2;

export interface ManualFinding {
  nodeId: string;
  name: string;
  screen: ScreenRef;
  width: number;
  height: number;
  shape: Shape;
  /** Своё оформление: видимая заливка, обводка или эффект. */
  visual: boolean;
}

/** Варианты кандидата (или он сам) с устройством, подходящие по размеру. */
function fitting(c: Candidate, size: { width: number; height: number }): Shape[] {
  const shapes = c.isSet ? (c.variants ?? []).map((v) => v.shape) : [c.shape];
  return shapes.filter((s): s is Shape => !!s && sizeDistance(size, { ...c, sizes: [s] }) <= SIZE_TOLERANCE);
}

const best = (f: ManualFinding, c: Candidate) => Math.max(-1, ...fitting(c, f).map((s) => structureScore(f.shape, s)));

/**
 * Пара для ручного фрейма:
 * - `named` — наш компонент с тем же именем, подходящий по размеру, устройство похоже ≥ NAMED_MIN;
 * - `similar` — имени нет, но у фрейма своё оформление и устройство похоже на один наш компонент ≥ SIMILAR_MIN
 *   с отрывом от следующего ≥ SIMILAR_MARGIN; иконки не предлагаются (это этап 3);
 * - иначе `composite` — наш составной компонент с теми же вложенными компонентами (этап 2в, composite.ts), или `none`.
 */
export function matchManual(f: ManualFinding, byName: ReadonlyMap<string, Candidate[]>, product?: string): MatchResult {
  const inProduct = (c: Candidate) => !product || c.product === product;

  const named = (byName.get(normalizeName(f.name)) ?? [])
    .filter(inProduct)
    .map((c) => ({ c, s: best(f, c) }))
    .filter((x) => x.s >= NAMED_MIN)
    .sort((a, b) => b.s - a.s);
  if (named.length) return { status: 'named', target: named[0].c, alternatives: named.map((x) => x.c), score: named[0].s };

  if (!f.visual || f.shape.textCount + f.shape.iconCount + f.shape.parts.length < SIMILAR_MIN_ELEMENTS) return matchComposite(f, byName, product);
  const all: { c: Candidate; s: number }[] = [];
  for (const list of byName.values()) {
    for (const c of list) {
      if (!inProduct(c) || c.kind === 'icons') continue;
      const s = best(f, c);
      if (s >= 0) all.push({ c, s });
    }
  }
  all.sort((a, b) => b.s - a.s);
  const [first, second] = all;
  if (first && first.s >= SIMILAR_MIN && (!second || first.s - second.s >= SIMILAR_MARGIN)) {
    return { status: 'similar', target: first.c, alternatives: all.filter((x) => x.s >= SIMILAR_MIN - SIMILAR_MARGIN).map((x) => x.c), score: first.s };
  }
  return matchComposite(f, byName, product);
}

/**
 * Группы ручных фреймов для отчёта: одно имя, примерно один размер (шаг 8 px) и одно устройство — одна группа.
 * Пара подбирается по первому фрейму группы, поэтому разное устройство — разные группы: на «✈️ Port queue» три
 * `balance panel/1. three items` одного размера, а иконки видны не у всех — один подходил к `bar/button`, другой нет.
 * Группировка не зависит от подбора, поэтому смена продукта не перестраивает отчёт.
 */
export function groupManual(findings: readonly ManualFinding[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup & { screenIds: Set<string> }>();
  for (const f of findings) {
    const { textCount, iconCount, layoutMode, parts } = f.shape;
    const structure = `t${textCount}i${iconCount}${layoutMode[0]}:${parts.map(normalizeName).sort().join(',')}`;
    const id = `m:${normalizeName(f.name)}|${Math.round(f.width / 8)}x${Math.round(f.height / 8)}|${structure}`;
    let g = groups.get(id);
    if (!g) {
      const origin: Origin = 'local';
      g = { id, origin, detached: false, manual: true, name: f.name, count: 0, screens: 0, exampleNodeId: f.nodeId, exampleScreen: f.screen.name, width: f.width, height: f.height, nodeIds: [], screenIds: new Set() };
      groups.set(id, g);
    }
    g.count++;
    g.nodeIds.push(f.nodeId);
    g.screenIds.add(f.screen.id);
  }
  return [...groups.values()].map(({ screenIds, ...g }) => ({ ...g, screens: screenIds.size })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
