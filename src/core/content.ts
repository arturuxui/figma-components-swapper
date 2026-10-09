// Контент экземпляра до и после замены: видимые тексты. Без Figma API — узел описан по форме,
// узлы Plugin API ей подходят. Часть движка замены.

export interface ContentNode {
  type: string;
  visible?: boolean;
  characters?: string;
  children?: readonly ContentNode[];
}

/** Тексты видимых слоёв (скрытый предок прячет и текст), без пустых. Порядок — порядок слоёв. */
export function visibleTexts(root: ContentNode): string[] {
  const out: string[] = [];
  const visit = (node: ContentNode, isRoot: boolean) => {
    if (!isRoot && node.visible === false) return;
    if (node.type === 'TEXT' && typeof node.characters === 'string') {
      const text = node.characters.trim();
      if (text) out.push(text);
    }
    for (const child of node.children ?? []) visit(child, false);
  };
  visit(root, true);
  return out;
}

/** Какие тексты были до замены и пропали после (с учётом повторов). */
export function lostTexts(before: readonly string[], after: readonly string[]): string[] {
  const pool = [...after];
  const lost: string[] = [];
  for (const text of before) {
    const i = pool.indexOf(text);
    if (i >= 0) pool.splice(i, 1);
    else lost.push(text);
  }
  return lost;
}
