// Переходы прототипа (reactions) при замене фрейма экземпляром. Без Figma API: переход описан по форме, переходы
// Plugin API ей подходят. Часть движка замены.
// Переход ведёт на слой через `destinationId` (действие NODE, медиа), внутри CONDITIONAL — в `conditionalBlocks[].actions`.
// Заменённый фрейм удаляется (`finalizeFrames`), поэтому переходы, ведущие на него или на его слои, перенаправляем
// на наш экземпляр — иначе они повиснут (#276, дефект 7).

/** Переход по форме Plugin API: остальные поля переносятся как есть. */
export interface ReactionLike {
  action?: unknown;
  actions?: readonly unknown[];
  [key: string]: unknown;
}

/** Копия действия, где `destinationId` из карты заменены; `changed` — было ли что менять. */
function retargetValue(value: unknown, to: ReadonlyMap<string, string>, changed: { any: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => retargetValue(v, to, changed));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'destinationId' && typeof v === 'string' && to.has(v)) {
      out[key] = to.get(v);
      changed.any = true;
    } else out[key] = retargetValue(v, to, changed);
  }
  return out;
}

/**
 * Переходы для записи (`setReactionsAsync`): при чтении Figma отдаёт действие и в устаревшем `action`, и в `actions` —
 * пишем только `actions`, если оно есть.
 */
export function writableReactions<R extends ReactionLike>(reactions: readonly R[]): R[] {
  return reactions.map((r) => {
    if (!r.actions || !('action' in r)) return r;
    const { action: _drop, ...rest } = r;
    return rest as R;
  });
}

/**
 * Переходы с перенаправленными целями: `to` — id прежней цели → id новой. Ничего не ведёт на прежние цели — null
 * (переходы слоя трогать не нужно).
 */
export function retargetReactions<R extends ReactionLike>(reactions: readonly R[], to: ReadonlyMap<string, string>): R[] | null {
  if (!to.size || !reactions.length) return null;
  const changed = { any: false };
  const next = reactions.map((r) => retargetValue(r, to, changed) as R);
  return changed.any ? writableReactions(next) : null;
}

/** Узел по форме: свои переходы и потомки. */
export interface ReactionNode {
  reactions?: readonly unknown[];
  children?: readonly ReactionNode[];
}

/** Сколько слоёв внутри (без самого корня) с переходами — их на экземпляр не перенести. */
export function innerReactionLayers(root: ReactionNode): number {
  let count = 0;
  const visit = (node: ReactionNode) => {
    for (const child of node.children ?? []) {
      if (child.reactions?.length) count++;
      visit(child);
    }
  };
  visit(root);
  return count;
}
