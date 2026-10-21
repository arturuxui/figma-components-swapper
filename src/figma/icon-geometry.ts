// Рисунок иконки из узлов Figma — пути для отпечатка (core/icon-shape.ts). Своя реализация (этап 3).
//
// Берём то, что видно: заливку фигуры — если у неё есть видимая заливка, обводку — если есть видимая обводка
// (`strokeGeometry` — уже контур обводки). Скрытые слои и маски не рисуются. Булева операция — готовая фигура,
// в её детей не спускаемся. Заливка контейнеров (фрейм, группа, экземпляр) — фон, а не рисунок.
// Положение слоя — по `absoluteTransform` относительно корня иконки: верно и с группами, и без.

import type { IconPath, Matrix } from '../core/icon-shape';

const SHAPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'STAR', 'POLYGON', 'LINE', 'TEXT']);

const visiblePaint = (paints: unknown) => Array.isArray(paints) && paints.some((p: Paint) => p.visible !== false && (p.opacity ?? 1) > 0);

function toMatrix(t: Transform): Matrix {
  return [t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2]];
}

function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function multiply([a1, b1, c1, d1, e1, f1]: Matrix, [a2, b2, c2, d2, e2, f2]: Matrix): Matrix {
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

/** Пути рисунка в координатах корня. Пустой список — рисовать нечего (иконка из картинки, всё скрыто). */
export function iconPaths(root: SceneNode): IconPath[] {
  const toRoot = invert(toMatrix(root.absoluteTransform));
  const out: IconPath[] = [];
  const visit = (node: SceneNode, isRoot: boolean) => {
    if (!isRoot && node.visible === false) return;
    if ('isMask' in node && node.isMask) return;
    if (SHAPES.has(node.type)) {
      const transform = multiply(toRoot, toMatrix(node.absoluteTransform));
      const shape = node as GeometryMixin & SceneNode;
      if (visiblePaint(shape.fills)) for (const g of shape.fillGeometry) out.push({ d: g.data, evenOdd: g.windingRule === 'EVENODD', transform });
      if (visiblePaint(shape.strokes)) for (const g of shape.strokeGeometry) out.push({ d: g.data, evenOdd: g.windingRule === 'EVENODD', transform });
      if (node.type === 'BOOLEAN_OPERATION') return;
    }
    if ('children' in node) for (const child of node.children) visit(child, false);
  };
  visit(root, true);
  return out;
}

/**
 * Цвет иконки. Многоцветная — видимые фигуры разных сплошных цветов или с градиентом/картинкой (прозрачность не в
 * счёт: части одной иконки). `paint` — цвет одноцветной: первая видимая заливка фигуры, а у контурной — обводка;
 * его и переносят на нашу иконку при замене (цвет — из макета, решение PD). Фон контейнеров не смотрим.
 */
export function iconColor(root: SceneNode): { multicolor: boolean; paint: SolidPaint | null } {
  const colors = new Set<string>();
  let other = false;
  let fill: SolidPaint | null = null;
  let stroke: SolidPaint | null = null;
  const visit = (node: SceneNode, isRoot: boolean) => {
    if (!isRoot && node.visible === false) return;
    if ('isMask' in node && node.isMask) return;
    if (!isRoot && SHAPES.has(node.type)) {
      const shape = node as GeometryMixin & SceneNode;
      for (const [list, isFill] of [[shape.fills, true], [shape.strokes, false]] as const) {
        for (const p of Array.isArray(list) ? (list as Paint[]) : []) {
          if (p.visible === false || (p.opacity ?? 1) === 0) continue;
          if (p.type !== 'SOLID') {
            other = true;
            continue;
          }
          colors.add([p.color.r, p.color.g, p.color.b].map((v) => Math.round(v * 255)).join(','));
          if (isFill) fill ??= p;
          else stroke ??= p;
        }
      }
      if (node.type === 'BOOLEAN_OPERATION') return;
    }
    if ('children' in node) for (const child of node.children) visit(child, false);
  };
  visit(root, true);
  const multicolor = other || colors.size > 1;
  return { multicolor, paint: multicolor ? null : (fill ?? stroke) };
}

/**
 * Цвет макета — на нашу иконку (после замены): видимые заливки и обводки фигур становятся этим цветом, прозрачность
 * слоя библиотеки сохраняется множителем (полупрозрачные части иконки). Фон контейнеров не трогаем.
 */
export function paintIcon(root: SceneNode, paint: SolidPaint) {
  const recolor = (list: readonly Paint[]) => list.map((p) => (p.visible === false || (p.opacity ?? 1) === 0 ? p : { ...paint, opacity: (paint.opacity ?? 1) * (p.opacity ?? 1) }));
  const visit = (node: SceneNode, isRoot: boolean) => {
    if (!isRoot && node.visible === false) return;
    if ('isMask' in node && node.isMask) return;
    if (!isRoot && SHAPES.has(node.type)) {
      const shape = node as GeometryMixin & SceneNode;
      if (visiblePaint(shape.fills)) shape.fills = recolor(shape.fills as Paint[]);
      if (visiblePaint(shape.strokes)) shape.strokes = recolor(shape.strokes as Paint[]);
      if (node.type === 'BOOLEAN_OPERATION') return;
    }
    if ('children' in node) for (const child of node.children) visit(child, false);
  };
  visit(root, true);
}
