// Снимок дерева узла для src/core/structure.ts: тип, имя, видимость, текст, размер, раскладка, имя главного
// компонента у экземпляров. Глубина ограничена: фрагменты для замены — компоненты, а не экраны.

import { ICON_MAX, type StructNode } from '../core/structure';

const MAX_DEPTH = 8;
/** Экран целиком (этап 4): глубже, чем фрагмент. */
export const SCREEN_DEPTH = 16;

/** Своё оформление фрейма: видимая заливка, обводка или эффект (правило 32 скилла). */
export function hasVisual(node: SceneNode): boolean {
  const shown = (list: unknown) => Array.isArray(list) && list.some((p: { visible?: boolean }) => p.visible !== false);
  return ('fills' in node && shown(node.fills)) || ('strokes' in node && shown(node.strokes)) || ('effects' in node && shown(node.effects));
}

export async function snapshot(node: SceneNode, depth = 0, maxDepth = MAX_DEPTH): Promise<StructNode> {
  const out: StructNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    visible: node.visible,
    width: node.width,
    height: node.height,
    layoutMode: 'layoutMode' in node ? node.layoutMode : undefined,
  };
  if (node.type === 'TEXT') out.characters = node.characters;
  if ('isMask' in node && node.isMask) out.isMask = true;
  if (node.type === 'FRAME') {
    if (hasVisual(node)) out.visual = true;
    if (node.detachedInfo) out.detached = true;
  }
  if (node.type === 'INSTANCE') {
    try {
      const main = await node.getMainComponentAsync();
      if (main) out.mainName = main.parent?.type === 'COMPONENT_SET' ? main.parent.name : main.name;
    } catch {
      // главный компонент не читается — останется имя слоя
    }
    // В иконку не спускаемся: внутри только векторы.
    if (Math.max(node.width, node.height) <= ICON_MAX) return out;
  }
  if ('children' in node && depth < maxDepth) {
    out.children = [];
    for (const child of node.children) out.children.push(await snapshot(child, depth + 1, maxDepth));
  }
  return out;
}
