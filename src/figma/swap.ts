// Замена экземпляра нашим компонентом: импорт по ключу (с кэшем), выбор варианта, `swapComponent`.
// Спайк 2026-10-09: `swapComponent` сохраняет тексты и вложенные instance swap — вложенные старые
// иконки остаются и заменяются отдельным проходом.

import { lostTexts, visibleTexts, type ContentNode } from '../core/content';
import type { Candidate } from '../core/match';
import { pickVariant, type VariantPick } from '../core/variants';

/** Импорт ~1 с на компонент — держим импортированное до закрытия плагина. */
const imported = new Map<string, Promise<ComponentNode | ComponentSetNode>>();

export function importTarget(target: Pick<Candidate, 'key' | 'isSet'>): Promise<ComponentNode | ComponentSetNode> {
  let p = imported.get(target.key);
  if (!p) {
    p = target.isSet ? figma.importComponentSetByKeyAsync(target.key) : figma.importComponentByKeyAsync(target.key);
    // Неудачный импорт не кэшируем: следующая попытка может пройти (сеть, публикация).
    p.catch(() => imported.delete(target.key));
    imported.set(target.key, p);
  }
  return p;
}

/** Компонент для замены: у набора — вариант по осям старого экземпляра, иначе вариант по умолчанию. */
export function chooseComponent(target: ComponentNode | ComponentSetNode, old: InstanceNode): { component: ComponentNode; pick: VariantPick | null } {
  if (target.type === 'COMPONENT') return { component: target, pick: null };
  const variants = target.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
  const pick = pickVariant(old.variantProperties, variants.map((v) => v.variantProperties ?? {}));
  return { component: pick.index >= 0 ? variants[pick.index] : target.defaultVariant, pick };
}

export interface SwapOutcome {
  pick: VariantPick | null;
  lost: string[];
  sizeChanged: boolean;
}

export async function swapInstance(node: InstanceNode, target: Pick<Candidate, 'key' | 'isSet'>): Promise<SwapOutcome> {
  const main = await importTarget(target);
  const before = visibleTexts(node as unknown as ContentNode);
  const { width, height } = node;
  const { component, pick } = chooseComponent(main, node);
  node.swapComponent(component);
  return {
    pick,
    lost: lostTexts(before, visibleTexts(node as unknown as ContentNode)),
    sizeChanged: Math.abs(node.width - width) > 0.5 || Math.abs(node.height - height) > 0.5,
  };
}
