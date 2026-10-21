// Контент экземпляра до и после замены: видимые тексты. Без Figma API — узел описан по форме,
// узлы Plugin API ей подходят. Часть движка замены.

import type { TextSlot } from './structure';

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

/**
 * Тексты, пропавшие при замене (слой лежит в другом месте, чем у нашего компонента), — обратно в слои нашего
 * компонента с тем же именем, где осталась заглушка (текста нет среди прежних). Только по однозначному имени, а
 * если остались один текст и одна заглушка — туда; по порядку не раскладываем — на клавиатуре Rider буквы разъехались
 * по чужим клавишам (прогон «5б»).
 * Сохранённые заменой тексты не трогаем.
 */
export function restoreTexts(before: readonly TextSlot[], after: readonly TextSlot[]): { id: string; text: string }[] {
  const lost = lostTexts(before.map((t) => t.text), after.map((t) => t.text));
  if (!lost.length) return [];
  const was = new Set(before.map((t) => t.text));
  const once = (list: readonly TextSlot[], name: string) => list.filter((t) => t.name === name).length === 1;
  const out: { id: string; text: string }[] = [];
  for (const slot of after) {
    if (!slot.id || was.has(slot.text) || !once(after, slot.name) || !once(before, slot.name)) continue;
    const source = before.find((t) => t.name === slot.name)!;
    const i = lost.indexOf(source.text);
    if (i < 0) continue;
    lost.splice(i, 1);
    out.push({ id: slot.id, text: source.text });
  }
  // Остались один пропавший текст и одна заглушка — однозначно (Alert: «В очередь» в слое `Text`, у нас `✏️Text here`).
  const free = after.filter((t) => t.id && !was.has(t.text) && !out.some((o) => o.id === t.id));
  if (lost.length === 1 && free.length === 1) out.push({ id: free[0].id!, text: lost[0] });
  return out;
}
