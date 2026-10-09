// Снимок дерева узла для src/core/structure.ts: тип, имя, видимость, текст, размер, раскладка, имя главного
// компонента у экземпляров. Глубина ограничена: фрагменты для замены — компоненты, а не экраны.

import { ICON_MAX, type StructNode } from '../core/structure';

const MAX_DEPTH = 8;

export async function snapshot(node: SceneNode, depth = 0): Promise<StructNode> {
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
  if ('children' in node && depth < MAX_DEPTH) {
    out.children = [];
    for (const child of node.children) out.children.push(await snapshot(child, depth + 1));
  }
  return out;
}
