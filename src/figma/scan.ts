// Скан макета (этап 1а): экземпляры компонентов и отвязанные фреймы в выделении или на странице.
// Только чтение — файл не меняется.

import type { KeyHit } from '../core/library-index';
import { classifyInstance, type DetachedFinding, type InstanceFinding, type ScreenRef } from '../core/scan-report';

export interface ScanResult {
  instances: InstanceFinding[];
  detached: DetachedFinding[];
  /** Экземпляры, у которых не прочитался главный компонент (удалён, недоступен). */
  unreadable: number;
}

const hasChildren = (node: SceneNode): node is SceneNode & ChildrenMixin => 'children' in node;

/**
 * Обход в глубину. В чужие и локальные экземпляры не спускаемся: они заменяются целиком, а вложенное
 * поправит проход по вложенным иконкам. В наши — спускаемся: внутри бывают подменённые чужие иконки.
 */
export async function scanNodes(roots: readonly SceneNode[], lookup: ReadonlyMap<string, KeyHit>, progress: (text: string) => void): Promise<ScanResult> {
  const result: ScanResult = { instances: [], detached: [], unreadable: 0 };
  let seen = 0;

  const visit = async (node: SceneNode, screen: ScreenRef): Promise<void> => {
    if (++seen % 500 === 0) progress(`Просмотрено слоёв: ${seen}`);

    if (node.type === 'INSTANCE') {
      let main: ComponentNode | null = null;
      try {
        main = await node.getMainComponentAsync();
      } catch {
        main = null;
      }
      if (!main) {
        result.unreadable++;
        return;
      }
      const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : null;
      const finding: InstanceFinding = {
        nodeId: node.id,
        screen,
        componentKey: main.key,
        componentName: main.name,
        setKey: set?.key,
        setName: set?.name,
        remote: main.remote,
        width: node.width,
        height: node.height,
      };
      result.instances.push(finding);
      if (classifyInstance(finding, lookup) !== 'ours') return;
    } else if (node.type === 'FRAME' && node.detachedInfo) {
      const info = node.detachedInfo;
      result.detached.push({
        nodeId: node.id,
        name: node.name,
        screen,
        width: node.width,
        height: node.height,
        detached: info.type === 'library' ? { type: 'library', componentKey: info.componentKey } : { type: 'local', componentId: info.componentId },
      });
    }

    if (hasChildren(node)) {
      for (const child of node.children) await visit(child, screen);
    }
  };

  for (const root of roots) await visit(root, { id: root.id, name: root.name });
  return result;
}
