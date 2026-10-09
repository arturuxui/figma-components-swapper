// Скан макета: экземпляры компонентов (этап 1), отвязанные фреймы (2а) и ручные фреймы — кандидаты 2б —
// в выделении или на странице.
// Только чтение — файл не меняется.

import type { KeyHit } from '../core/library-index';
import { classifyInstance, type DetachedFinding, type InstanceFinding, type ScreenRef } from '../core/scan-report';
import { REPLACED_MARK } from './replace-frame';

export interface ScanResult {
  instances: InstanceFinding[];
  detached: DetachedFinding[];
  /** Экземпляры, у которых не прочитался главный компонент (удалён, недоступен). */
  unreadable: number;
  /** Ручные фреймы, прошедшие быстрый отбор (`manual`), — их устройство считает вызывающий. */
  manual: { node: FrameNode; screen: ScreenRef }[];
}

/** Больше ручных кандидатов не собираем: снимок устройства каждого стоит времени. */
const MANUAL_LIMIT = 2000;

const hasChildren = (node: SceneNode): node is SceneNode & ChildrenMixin => 'children' in node;

/**
 * Обход в глубину. В чужие и локальные экземпляры не спускаемся: они заменяются целиком, а вложенное
 * поправит проход по вложенным иконкам. В наши — спускаемся: внутри бывают подменённые чужие иконки.
 */
export async function scanNodes(
  roots: readonly SceneNode[],
  lookup: ReadonlyMap<string, KeyHit>,
  progress: (text: string) => void,
  /** Быстрый отбор ручных фреймов (размер или имя как у нашего компонента). Нет — ручные не ищутся. */
  manual?: (node: FrameNode) => boolean,
): Promise<ScanResult> {
  const result: ScanResult = { instances: [], detached: [], unreadable: 0, manual: [] };
  let seen = 0;

  /** Экран — фрейм верхнего уровня страницы или секции; ручные кандидаты — только внутри экранов (не аннотации на холсте). */
  const isScreen = (node: SceneNode) => node.type === 'FRAME' && (node.parent?.type === 'PAGE' || node.parent?.type === 'SECTION');

  const visit = async (node: SceneNode, screen: ScreenRef, insideInstance: boolean, insideScreen: boolean): Promise<void> => {
    if (++seen % 500 === 0) progress(`Просмотрено слоёв: ${seen}`);
    // Фрейм, уже заменённый экземпляром и ждущий удаления (см. replace-frame.ts), — не находка.
    if (node.type === 'FRAME' && !node.visible) {
      try {
        if (node.getPluginData(REPLACED_MARK)) return;
      } catch {
        // нет pluginData — обычный скрытый фрейм
      }
    }

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
      insideInstance = true;
    } else if (node.type === 'FRAME' && node.detachedInfo && node.visible) {
      // Скрытый отвязанный фрейм в макете не виден — менять его незачем.
      const info = node.detachedInfo;
      result.detached.push({
        nodeId: node.id,
        name: node.name,
        screen,
        width: node.width,
        height: node.height,
        detached: info.type === 'library' ? { type: 'library', componentKey: info.componentKey } : { type: 'local', componentId: info.componentId },
      });
    } else if (
      manual &&
      node.type === 'FRAME' &&
      node.visible &&
      !insideInstance &&
      insideScreen &&
      !isScreen(node) &&
      node.children.length > 0 &&
      result.manual.length < MANUAL_LIMIT &&
      manual(node)
    ) {
      result.manual.push({ node, screen });
    }

    if (hasChildren(node)) {
      for (const child of node.children) await visit(child, screen, insideInstance, insideScreen || isScreen(node));
    }
  };

  // Выделен фрагмент внутри экрана — он уже «внутри экрана».
  for (const root of roots) await visit(root, { id: root.id, name: root.name }, false, root.parent?.type !== 'PAGE' && root.parent?.type !== 'SECTION');
  return result;
}
