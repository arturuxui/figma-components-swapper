// Повторы → кандидаты в новые компоненты (этап 4, правило 26 скилла: предлагать недостающие компоненты; Шаг 02b —
// аудит некомпонентных элементов). Без Figma API. Часть движка замены.
//
// Ищем во всех экранах фреймы одного устройства (одинаковое дерево видимых слоёв: тексты, иконки, вложенные
// компоненты, раскладка; высота с шагом 4 px), которые не компоненты и не копии наших, и показываем те, что
// встречаются хотя бы на REPEAT_MIN_SCREENS экранах или в REPEAT_MIN_PLACES местах. Из вложенных повторов
// (строка и её содержимое) остаётся внешний. Различия между копиями (какие тексты и иконки меняются) — будущие
// свойства компонента.

import { normalizeName, sizeDistance, SIZE_TOLERANCE, type Candidate } from './match';
import type { ScreenRef } from './scan-report';
import { ICON_MAX, isOutlinedText, shapeOf, signature, structureScore, type Shape, type StructNode } from './structure';

/** Повтор — на стольких экранах… */
export const REPEAT_MIN_SCREENS = 3;
/** …или в стольких местах. */
export const REPEAT_MIN_PLACES = 5;
/** Хотя бы столько элементов (тексты, иконки, вложенные компоненты): иначе это «прямоугольник с текстом». */
export const REPEAT_MIN_ELEMENTS = 2;
/** Внутренний повтор убираем, если хотя бы такая доля его мест лежит внутри мест внешнего. */
export const NESTED_SHARE = 0.8;
/**
 * Часть экрана, а не компонент: выше стольких высот экрана и почти во всю его ширину. На «👑 Main Screen» так
 * повторялась шторка «Предзаказы» 360×632 целиком.
 */
export const SCREEN_PART_HEIGHT = 0.6;
export const SCREEN_PART_WIDTH = 0.9;
/**
 * Похож на наш компонент хотя бы настолько — скорее копия нашего, которую 2б не узнал (карточки тарифа на
 * «✈️ Port queue»), чем новый компонент: такой повтор идёт в конец списка с пометкой.
 */
export const LIKE_OURS_MIN = 0.85;

export interface RepeatGroup {
  /** `r:` + отпечаток устройства. */
  id: string;
  /** Самое частое имя фрейма. */
  name: string;
  count: number;
  screens: number;
  nodeIds: string[];
  exampleNodeId: string;
  exampleScreen: string;
  width: number;
  height: number;
  texts: number;
  icons: number;
  /** Вложенные компоненты — по имени. */
  parts: string[];
  /** Сколько текстов и иконок отличаются между копиями — кандидаты в свойства компонента. */
  varying: { texts: number; icons: number };
  /** Номера меняющихся текстов и иконок (порядок — как в `signature`): по ним черновик получает свойства. */
  varyingAt: { texts: number[]; icons: number[] };
  /** Похож на наш компонент (≥ LIKE_OURS_MIN) — его имя: возможно, копия нашего, а не новый компонент. */
  likeOurs?: string;
}

interface Place {
  node: StructNode;
  screen: ScreenRef & { width: number; height: number };
  /** id фреймов-предков внутри экрана. */
  ancestors: string[];
}

const isIconNode = (n: StructNode) => Math.max(n.width, n.height) <= ICON_MAX && (n.type === 'INSTANCE' || n.type === 'FRAME' || n.type === 'GROUP');
const isContainer = (n: StructNode) => n.type === 'FRAME' || n.type === 'GROUP';

/** Отпечаток устройства видимого поддерева: без самих текстов, имён слоёв и ширины (тексты её меняют). */
function fingerprint(n: StructNode): string {
  if (n.type === 'TEXT' || isOutlinedText(n)) return 'T';
  if (isIconNode(n) && (n.type === 'INSTANCE' || !hasText(n))) return 'I';
  if (n.type === 'INSTANCE') return `C:${normalizeName(n.mainName ?? n.name)}`;
  if (!isContainer(n)) return 'S';
  const kids = (n.children ?? []).filter((c) => c.visible !== false).map(fingerprint);
  return `${(n.layoutMode ?? 'NONE')[0]}${n.visual ? 'v' : ''}(${kids.join(',')})`;
}

const hasText = (n: StructNode): boolean => n.type === 'TEXT' || (n.children ?? []).some(hasText);

/** Места-кандидаты в экране: видимые фреймы с оформлением или раскладкой — не внутри экземпляров, отвязанных и копий наших. */
function collect(screen: StructNode, screenRef: ScreenRef, exclude: ReadonlySet<string>): Place[] {
  const out: Place[] = [];
  const ref = { ...screenRef, width: screen.width, height: screen.height };
  const screenPart = (n: StructNode) => n.height >= SCREEN_PART_HEIGHT * ref.height && n.width >= SCREEN_PART_WIDTH * ref.width;
  const visit = (n: StructNode, ancestors: string[]) => {
    // Внутри экземпляров, отвязанных фреймов и копий наших компонентов — не новые компоненты.
    if (n.visible === false || n.type === 'INSTANCE' || n.detached || (n.id && exclude.has(n.id))) return;
    if (n !== screen && n.type === 'FRAME' && n.id && (n.visual || (n.layoutMode ?? 'NONE') !== 'NONE') && !screenPart(n)) {
      out.push({ node: n, screen: ref, ancestors });
    }
    const next = n !== screen && n.id ? [...ancestors, n.id] : ancestors;
    for (const c of n.children ?? []) visit(c, next);
  };
  visit(screen, []);
  return out;
}

const mostCommon = (names: string[]) => {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
};

/** Позиции списков, которые отличаются между копиями (списки одной длины — устройство одно). */
function varyingSlots(lists: string[][]): number[] {
  const len = Math.min(...lists.map((l) => l.length));
  const out: number[] = [];
  for (let i = 0; i < len; i++) if (new Set(lists.map((l) => l[i])).size > 1) out.push(i);
  return out;
}

const varying = (texts: string[][], icons: string[][]) => {
  const at = { texts: varyingSlots(texts), icons: varyingSlots(icons) };
  return { varying: { texts: at.texts.length, icons: at.icons.length }, varyingAt: at };
};

/** Самый похожий наш компонент (размер ±20 %, иконки не в счёт) и похожесть. */
function closestOurs(shape: Shape, ours: Iterable<Candidate>): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const c of ours) {
    if (c.kind === 'icons') continue;
    const shapes = c.isSet ? (c.variants ?? []).map((v) => v.shape) : [c.shape];
    for (const s of shapes) {
      if (!s || sizeDistance(shape, { ...c, sizes: [s] }) > SIZE_TOLERANCE) continue;
      const score = structureScore(shape, s);
      if (!best || score > best.score) best = { name: c.name, score };
    }
  }
  return best;
}

/**
 * Повторы во всех экранах. `exclude` — фреймы, у которых уже есть пара среди наших компонентов (этап 2б): это
 * копии наших, а не новые компоненты. `ours` — наши компоненты продукта: повтор, очень похожий на один из них,
 * помечается и уходит в конец списка.
 */
export function findRepeats(
  screens: readonly { ref: ScreenRef; tree: StructNode }[],
  exclude: ReadonlySet<string> = new Set(),
  ours: readonly Candidate[] = [],
): RepeatGroup[] {
  const byKey = new Map<string, Place[]>();
  for (const { ref, tree } of screens) {
    for (const p of collect(tree, ref, exclude)) {
      const sig = signature(p.node);
      if (sig.texts.length + (sig.outlined ?? 0) + sig.icons.length + sig.parts.length < REPEAT_MIN_ELEMENTS) continue;
      const key = `${fingerprint(p.node)}|h${Math.round(p.node.height / 4)}`;
      const list = byKey.get(key) ?? [];
      list.push(p);
      byKey.set(key, list);
    }
  }

  const clusters = [...byKey.entries()]
    .map(([key, places]) => ({ key, places, screens: new Set(places.map((p) => p.screen.id)).size }))
    .filter((c) => c.screens >= REPEAT_MIN_SCREENS || c.places.length >= REPEAT_MIN_PLACES)
    // Внешние раньше внутренних: по площади примера.
    .sort((a, b) => b.places[0].node.width * b.places[0].node.height - a.places[0].node.width * a.places[0].node.height);

  const kept: typeof clusters = [];
  const keptIds = new Set<string>();
  for (const c of clusters) {
    const inside = c.places.filter((p) => p.ancestors.some((id) => keptIds.has(id))).length;
    if (inside >= NESTED_SHARE * c.places.length) continue;
    kept.push(c);
    for (const p of c.places) if (p.node.id) keptIds.add(p.node.id);
  }

  return kept
    .map(({ key, places, screens: screenCount }) => {
      const sigs = places.map((p) => signature(p.node));
      const first = places[0];
      const like = closestOurs(shapeOf(sigs[0]), ours);
      return {
        likeOurs: like && like.score >= LIKE_OURS_MIN ? like.name : undefined,
        id: `r:${key}`,
        name: mostCommon(places.map((p) => p.node.name)),
        count: places.length,
        screens: screenCount,
        nodeIds: places.map((p) => p.node.id!).filter(Boolean),
        exampleNodeId: first.node.id!,
        exampleScreen: first.screen.name,
        width: first.node.width,
        height: first.node.height,
        texts: sigs[0].texts.length + (sigs[0].outlined ?? 0),
        icons: sigs[0].icons.length,
        parts: [...sigs[0].parts],
        ...varying(sigs.map((s) => s.texts.map((t) => t.text)), sigs.map((s) => s.icons)),
      };
    })
    .sort((a, b) => Number(!!a.likeOurs) - Number(!!b.likeOurs) || b.count - a.count || b.screens - a.screens || a.name.localeCompare(b.name));
}
