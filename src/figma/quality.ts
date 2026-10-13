// Счётчики чек-листа стандартов (src/core/quality.ts) по слоям узла: только чтение. Внутрь вложенных экземпляров не
// заходим — их качество отвечает за их мастер.

import type { Quality } from '../core/quality';

type Bindable = { boundVariables?: Record<string, unknown> };

const solid = (list: unknown): Paint[] =>
  Array.isArray(list) ? (list as Paint[]).filter((p) => p.type === 'SOLID' && p.visible !== false) : [];

const styled = (id: unknown) => typeof id === 'string' && id.length > 0;

function countPaints(node: SceneNode, q: Quality) {
  for (const [key, styleKey] of [['fills', 'fillStyleId'], ['strokes', 'strokeStyleId']] as const) {
    if (!(key in node)) continue;
    const paints = solid((node as unknown as Record<string, unknown>)[key]);
    const byStyle = styled((node as unknown as Record<string, unknown>)[styleKey]);
    for (const p of paints) {
      q.paints++;
      if (byStyle || (p as SolidPaint).boundVariables?.color) q.paintsBound++;
    }
  }
}

const SPACING = ['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const;

function countSpacing(node: FrameNode | ComponentNode | InstanceNode, q: Quality) {
  const bound = (node as Bindable).boundVariables ?? {};
  const shown = node.children.filter((c) => c.visible).length;
  for (const key of SPACING) {
    if (key === 'itemSpacing' && (shown < 2 || node.primaryAxisAlignItems === 'SPACE_BETWEEN')) continue;
    const value = node[key];
    if (!value) continue;
    q.spacings++;
    if (bound[key]) q.spacingsBound++;
    if (Math.abs(value % 4) < 0.01) q.spacingsOn4++;
  }
}

export function measure(root: SceneNode): Quality {
  const q: Quality = { containers: 0, autoLayout: 0, paints: 0, paintsBound: 0, texts: 0, textsStyled: 0, spacings: 0, spacingsBound: 0, spacingsOn4: 0 };
  const visit = (node: SceneNode, isRoot: boolean) => {
    if (!node.visible && !isRoot) return;
    countPaints(node, q);
    if (node.type === 'TEXT') {
      q.texts++;
      const bound = (node as Bindable).boundVariables ?? {};
      if (styled(node.textStyleId) || bound.fontSize || bound.fontFamily) q.textsStyled++;
      return;
    }
    // Вложенный экземпляр — чужой мастер: считаем только его собственную заливку (выше).
    if (node.type === 'INSTANCE' && !isRoot) return;
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      if (node.children.filter((c) => c.visible).length >= 2) {
        q.containers++;
        if (node.layoutMode !== 'NONE') q.autoLayout++;
      }
      if (node.layoutMode !== 'NONE') countSpacing(node, q);
    }
    if ('children' in node) for (const c of node.children) visit(c, false);
  };
  visit(root, true);
  return q;
}
