// Расхождения экземпляров со своим компонентом (этап 5, правило 17 скилла: не молчать о расхождении с мастером).
// Без Figma API. Часть движка замены.
//
// Экземпляр в макете могут перекрасить, убрать у него фон, поменять стиль текста. Это может быть ошибкой дизайнера,
// а может значить, что компоненту не хватает варианта (правило 13). Сами мы не решаем: одинаковые расхождения
// собираются по местам и показываются пользователю с выбором действия.

import type { ScreenRef } from './scan-report';

/** Что именно расходится. */
export type OverrideField = 'fill' | 'stroke' | 'textColor' | 'textStyle' | 'visible' | 'opacity' | 'radius' | 'effect';

export const FIELD_LABEL: Record<OverrideField, string> = {
  fill: 'заливка',
  stroke: 'обводка',
  textColor: 'цвет текста',
  textStyle: 'стиль текста',
  visible: 'видимость',
  opacity: 'прозрачность',
  radius: 'скругление',
  effect: 'эффект',
};

export interface OverrideDiff {
  /** Слой: «компонент» для корня, иначе имя слоя. */
  layer: string;
  field: OverrideField;
  /** Как в компоненте и как в макете — уже по-человечески: имя стиля, цвет, «нет». */
  from: string;
  to: string;
}

/**
 * Что сделать с расхождением:
 * - `error` — ошибка макета: при замене не переносить, будет как в нашем компоненте;
 * - `keep` — перенести на наш экземпляр как переопределение;
 * - `variant` — нужен вариант: предложение доработки компонента.
 */
export type OverrideChoice = 'error' | 'keep' | 'variant';

export const CHOICE_LABEL: Record<OverrideChoice, string> = {
  error: 'Ошибка макета — не переносить',
  keep: 'Перенести как есть',
  variant: 'Нужен вариант — в предложения',
};

/** То же для наших экземпляров: замены нет, «перенести» — значит оставить. */
export const OURS_CHOICE_LABEL: Record<OverrideChoice, string> = {
  error: 'Ошибка макета — вернуть как в компоненте',
  keep: 'Оставить как есть',
  variant: 'Нужен вариант — оставить и в предложения',
};

export interface OverrideGroup {
  /** `o:` + id группы отчёта + набор расхождений. */
  id: string;
  /** Группа отчёта (компонент, который заменяем). */
  groupId: string;
  diffs: OverrideDiff[];
  count: number;
  screens: number;
  nodeIds: string[];
  exampleNodeId: string;
  exampleScreen: string;
}

export interface InstanceOverrides {
  nodeId: string;
  screen: ScreenRef;
  diffs: OverrideDiff[];
}

const diffKey = (d: OverrideDiff) => `${d.layer}\u0000${d.field}\u0000${d.from}\u0000${d.to}`;

/** Одинаковые наборы расхождений — одна группа; самые частые первыми. Экземпляры без расхождений не в счёт. */
export function groupOverrides(groupId: string, items: readonly InstanceOverrides[]): OverrideGroup[] {
  const groups = new Map<string, OverrideGroup & { screenIds: Set<string> }>();
  for (const it of items) {
    if (!it.diffs.length) continue;
    const diffs = [...it.diffs].sort((a, b) => diffKey(a).localeCompare(diffKey(b)));
    const key = diffs.map(diffKey).join('\u0001');
    let g = groups.get(key);
    if (!g) {
      g = { id: `o:${groupId}|${key}`, groupId, diffs, count: 0, screens: 0, nodeIds: [], exampleNodeId: it.nodeId, exampleScreen: it.screen.name, screenIds: new Set() };
      groups.set(key, g);
    }
    g.count++;
    g.nodeIds.push(it.nodeId);
    g.screenIds.add(it.screen.id);
  }
  return [...groups.values()]
    .map(({ screenIds, ...g }) => ({ ...g, screens: screenIds.size }))
    .sort((a, b) => b.count - a.count || b.screens - a.screens);
}

/** «фон компонента: заливка «Bg day/actions» → нет». */
export const diffText = (d: OverrideDiff) => `${d.layer}: ${FIELD_LABEL[d.field]} «${d.from}» → «${d.to}»`;
