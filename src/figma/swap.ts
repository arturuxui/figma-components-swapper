// Замена экземпляра нашим компонентом: импорт по ключу (с кэшем), выбор варианта, `swapComponent`.
// Спайк 2026-10-09: `swapComponent` сохраняет тексты и вложенные instance swap — вложенные старые
// иконки остаются и заменяются отдельным проходом. Тексты переносятся только в слои с тем же именем: пропавшие
// (прогон на Rider: текст в рамке `Subtitle2`, у нас — `Subtitle`) возвращаем сами — в слой с тем же именем.
// Вложенная иконка в слое с другим именем тоже теряется (Alert: `plane` → иконка по умолчанию) — возвращаем по месту,
// если иконок столько же. Вариант набора — по осям старого экземпляра, а если оси не совпали ни одной — по устройству
// (как у фреймов): у старого Alert осей нет, и вариант по умолчанию был с двумя кнопками вместо одной.

import { lostTexts, restoreTexts, visibleTexts, type ContentNode } from '../core/content';
import { ICON_MAX, iconsToRestore, pickByStructure, signature, type Signature } from '../core/structure';
import { snapshot } from './structure';
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

const signatures = new Map<string, Promise<Signature>>();
/**
 * Устройство варианта нашего компонента (кэш до закрытия плагина). Снимаем с временного экземпляра: у только что
 * подгруженного компонента вложенные экземпляры читаются пустыми (Alert: кнопка `wide` без надписи — вариант с одной
 * кнопкой проигрывал варианту с двумя). Иконку (≤ 48) — с самого компонента: в экземпляр-иконку снимок не спускается.
 */
export function variantSignature(c: ComponentNode): Promise<Signature> {
  let p = signatures.get(c.id);
  if (!p) {
    p = (async () => {
      if (Math.max(c.width, c.height) <= ICON_MAX) return signature(await snapshot(c));
      const probe = c.createInstance();
      try {
        return signature(await snapshot(probe));
      } finally {
        probe.remove();
      }
    })();
    signatures.set(c.id, p);
  }
  return p;
}

/**
 * Компонент для замены: у набора — вариант по осям старого экземпляра; если ни одна ось не совпала — ближайший по
 * устройству (тексты, иконки, части, размер); иначе вариант по умолчанию.
 */
export async function chooseComponent(target: ComponentNode | ComponentSetNode, old: InstanceNode): Promise<{ component: ComponentNode; pick: VariantPick | null }> {
  if (target.type === 'COMPONENT') return { component: target, pick: null };
  const variants = target.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
  const pick = pickVariant(old.variantProperties, variants.map((v) => v.variantProperties ?? {}));
  if (pick.matched > 0) return { component: variants[pick.index], pick };
  const shape = pickByStructure(signature(await snapshot(old)), await Promise.all(variants.map(variantSignature)));
  return { component: variants[shape.index] ?? target.defaultVariant, pick };
}

export interface SwapOutcome {
  pick: VariantPick | null;
  lost: string[];
  sizeChanged: boolean;
}

/** Главный компонент иконки-экземпляра (у отвязанной иконки — нет). */
async function mainOf(id: string | undefined): Promise<ComponentNode | null> {
  const node = id ? await figma.getNodeByIdAsync(id) : null;
  return node?.type === 'INSTANCE' ? node.getMainComponentAsync().catch(() => null) : null;
}

/** Текст слоя внутри экземпляра. Привязанный к текстовому свойству — через свойство владельца, иначе слой. */
async function writeText(root: InstanceNode, id: string, text: string) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'TEXT' || node.characters === text) return;
  const ref = node.componentPropertyReferences?.characters;
  if (ref) {
    for (let p: BaseNode | null = node.parent; p; p = p.id === root.id ? null : p.parent) {
      if (p.type === 'INSTANCE' && ref in p.componentProperties) {
        p.setProperties({ [ref]: text });
        return;
      }
    }
  }
  const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName as FontName];
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  node.characters = text;
}

export async function swapInstance(node: InstanceNode, target: Pick<Candidate, 'key' | 'isSet'>): Promise<SwapOutcome> {
  const main = await importTarget(target);
  const before = visibleTexts(node as unknown as ContentNode);
  const was = signature(await snapshot(node));
  const icons = await Promise.all(was.iconIds.map(mainOf));
  const { width, height } = node;
  const { component, pick } = await chooseComponent(main, node);
  node.swapComponent(component);
  const now = signature(await snapshot(node));
  // Иконки — по месту, если их столько же; старая иконка остаётся как была (чужую заменит второй проход apply).
  for (const [i, name] of iconsToRestore(was.icons, now.icons).entries()) {
    const id = now.iconIds[i];
    const slot = name && id ? await figma.getNodeByIdAsync(id) : null;
    if (slot?.type === 'INSTANCE' && icons[i]) slot.swapComponent(icons[i]!);
  }
  if (lostTexts(before, visibleTexts(node as unknown as ContentNode)).length) {
    for (const { id, text } of restoreTexts(was.texts, signature(await snapshot(node)).texts)) await writeText(node, id, text);
  }
  return {
    pick,
    lost: lostTexts(before, visibleTexts(node as unknown as ContentNode)),
    sizeChanged: Math.abs(node.width - width) > 0.5 || Math.abs(node.height - height) > 0.5,
  };
}
