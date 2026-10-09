// Сбор индекса в открытом файле библиотеки: все опубликуемые компоненты и наборы на всех страницах.

import { INDEX_FORMAT, isPrivateName, parseVariantName, type IndexEntry, type IndexSet, type LibraryIndex, type LibraryKind } from '../core/library-index';

export interface IndexTarget {
  libraryId: string;
  product: string;
  kind: LibraryKind;
  fileKey: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Оси набора из определений свойств. Сломанный набор (конфликт вариантов) бросает — тогда оси из имён вариантов. */
function axesOf(set: ComponentSetNode): Record<string, string[]> {
  try {
    const axes: Record<string, string[]> = {};
    for (const [name, def] of Object.entries(set.componentPropertyDefinitions)) {
      if (def.type === 'VARIANT') axes[name] = [...(def.variantOptions ?? [])];
    }
    return axes;
  } catch {
    const axes: Record<string, Set<string>> = {};
    for (const child of set.children) {
      for (const [axis, value] of Object.entries(parseVariantName(child.name) ?? {})) (axes[axis] ??= new Set()).add(value);
    }
    return Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, [...v]]));
  }
}

export async function buildLibraryIndex(target: IndexTarget, progress: (text: string) => void): Promise<LibraryIndex> {
  await figma.loadAllPagesAsync();
  const entries: IndexEntry[] = [];
  const sets: IndexSet[] = [];

  for (const page of figma.root.children) {
    progress(`Страница «${page.name}»`);
    for (const node of page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
      if (node.type === 'COMPONENT_SET') {
        if (isPrivateName(node.name)) continue;
        const variants = node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
        sets.push({ key: node.key, name: node.name, axes: axesOf(node), variants: variants.length });
        for (const v of variants) {
          entries.push({
            key: v.key,
            name: v.name,
            setKey: node.key,
            setName: node.name,
            variant: parseVariantName(v.name) ?? undefined,
            width: round(v.width),
            height: round(v.height),
            page: page.name,
          });
        }
      } else if (node.parent?.type !== 'COMPONENT_SET' && !isPrivateName(node.name)) {
        entries.push({ key: node.key, name: node.name, width: round(node.width), height: round(node.height), page: page.name });
      }
    }
  }

  return { format: INDEX_FORMAT, ...target, takenAt: new Date().toISOString(), entries, sets };
}
