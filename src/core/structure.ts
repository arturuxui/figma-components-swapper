// Структура фрагмента макета (этап 2): что в нём видно — тексты, иконки, вложенные компоненты, раскладка, размер.
// Без Figma API: снимок дерева строит src/figma/structure.ts. Часть движка замены.
//
// Нужна, чтобы отвязанный или ручной фрейм заменить экземпляром нашего компонента: выбрать вариант набора,
// похожий по устройству (правило 21 скилла: сравнивать дерево, а не только картинку), и перенести в него
// тексты и иконки фрейма (Шаг 05b, пункт «Перенести оверрайды»).

/** Иконка — экземпляр или фрейм не больше этого по большей стороне, px (как у сканера иконок Token Comparator). */
export const ICON_MAX = 48;

export interface StructNode {
  /** id узла в файле — чтобы потом записать текст или заменить иконку. */
  id?: string;
  type: string;
  name: string;
  visible?: boolean;
  characters?: string;
  width: number;
  height: number;
  layoutMode?: string;
  /** Имя главного компонента (у набора — имя набора) — для экземпляров. */
  mainName?: string;
  children?: StructNode[];
}

export interface TextSlot {
  /** Имя слоя. */
  name: string;
  text: string;
  id?: string;
}

export interface Signature {
  width: number;
  height: number;
  layoutMode: string;
  /** Видимые тексты по порядку слоёв. */
  texts: TextSlot[];
  /** Видимые иконки по порядку: имя главного компонента или, у отвязанной иконки, имя фрейма. */
  icons: string[];
  /** id узлов иконок — в том же порядке. */
  iconIds: (string | undefined)[];
  /** Видимые вложенные компоненты крупнее иконки — по имени. */
  parts: string[];
}

const isIcon = (n: StructNode) => Math.max(n.width, n.height) <= ICON_MAX && (n.type === 'INSTANCE' || n.type === 'FRAME' || n.type === 'GROUP');

/** Иконкой считаем экземпляр размером с иконку или фрейм размером с иконку без текста внутри (отвязанная иконка). */
function iconName(n: StructNode): string | null {
  if (!isIcon(n)) return null;
  if (n.type === 'INSTANCE') return n.mainName ?? n.name;
  const hasText = (x: StructNode): boolean => x.type === 'TEXT' || (x.children ?? []).some(hasText);
  return hasText(n) ? null : n.name;
}

export function signature(root: StructNode): Signature {
  const sig: Signature = { width: root.width, height: root.height, layoutMode: root.layoutMode ?? 'NONE', texts: [], icons: [], iconIds: [], parts: [] };
  const visit = (n: StructNode, isRoot: boolean) => {
    if (!isRoot && n.visible === false) return;
    if (!isRoot) {
      const icon = iconName(n);
      if (icon) {
        sig.icons.push(icon);
        sig.iconIds.push(n.id);
        return;
      }
      if (n.type === 'INSTANCE') sig.parts.push(n.mainName ?? n.name);
    }
    if (n.type === 'TEXT' && typeof n.characters === 'string' && n.characters.trim()) sig.texts.push({ name: n.name, text: n.characters.trim(), id: n.id });
    for (const c of n.children ?? []) visit(c, false);
  };
  visit(root, true);
  return sig;
}

const side = (a: number, b: number) => (Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b));

/** Доля совпавших элементов двух списков с повторами (0..1); оба пустые — 1. */
function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1;
  const pool = b.map((x) => x.toLowerCase());
  let same = 0;
  for (const x of a) {
    const i = pool.indexOf(x.toLowerCase());
    if (i >= 0) {
      pool.splice(i, 1);
      same++;
    }
  }
  return same / Math.max(a.length, b.length);
}

/**
 * Устройство без самих текстов и id — то, что хранится в индексе библиотеки для каждого варианта (этап 2б):
 * сравнивать ручной фрейм со всеми нашими компонентами, не открывая файл библиотеки.
 */
export interface Shape {
  width: number;
  height: number;
  layoutMode: string;
  textCount: number;
  iconCount: number;
  /** Вложенные компоненты крупнее иконки — по имени. */
  parts: string[];
}

export const shapeOf = (sig: Signature): Shape => ({
  width: sig.width,
  height: sig.height,
  layoutMode: sig.layoutMode,
  textCount: sig.texts.length,
  iconCount: sig.icons.length,
  parts: [...sig.parts],
});

const asShape = (x: Signature | Shape): Shape => ('textCount' in x ? x : shapeOf(x));

/**
 * Похожесть устройства фрагмента и варианта нашего компонента, 0..1. Вес: число текстов — главное (иначе тексты
 * некуда переносить), дальше число иконок, вложенные компоненты, раскладка, размер.
 */
export function structureScore(sa: Signature | Shape, sb: Signature | Shape): number {
  const a = asShape(sa);
  const b = asShape(sb);
  const count = (x: number, y: number) => (x === y ? 1 : Math.min(x, y) / Math.max(x, y));
  const texts = count(a.textCount, b.textCount);
  const icons = count(a.iconCount, b.iconCount);
  const parts = overlap(a.parts, b.parts);
  const layout = a.layoutMode === b.layoutMode ? 1 : 0;
  const size = 1 - Math.min(1, Math.max(side(a.width, b.width), side(a.height, b.height)));
  return 0.35 * texts + 0.2 * icons + 0.15 * parts + 0.1 * layout + 0.2 * size;
}

/** Вариант набора, больше всего похожий на фрагмент. */
export function pickByStructure(target: Signature, variants: readonly Signature[]): { index: number; score: number } {
  let index = -1;
  let score = -1;
  variants.forEach((v, i) => {
    const s = structureScore(target, v);
    if (s > score) {
      score = s;
      index = i;
    }
  });
  return { index, score };
}

/** Число (счётчик, цена, время): только цифры, знаки и единицы-символы. */
const isNumeric = (s: string) => /^[\s\d.,:+\-–—%₽$€×]+$/.test(s) && /\d/.test(s);

/**
 * Какой текст фрагмента поставить в какой текстовый слот нашего компонента: сначала по совпавшему имени слоя
 * (если имя у обоих единственное), остальные — по порядку, но число — в слот, где в компоненте число (счётчик),
 * слово — в слот со словом. Возвращает текст для каждого слота (null — оставить как в компоненте) и тексты,
 * которым места не нашлось.
 */
export function mapTexts(source: readonly TextSlot[], slots: readonly { name: string; text?: string }[]): { texts: (string | null)[]; lost: string[] } {
  const out: (string | null)[] = slots.map(() => null);
  const used = new Set<number>();
  const count = (list: readonly { name: string }[], name: string) => list.filter((x) => x.name === name).length;
  slots.forEach((slot, i) => {
    if (count(slots, slot.name) !== 1 || count(source, slot.name) !== 1) return;
    const j = source.findIndex((s) => s.name === slot.name);
    out[i] = source[j].text;
    used.add(j);
  });
  const rest = source.map((s, j) => ({ s, j })).filter(({ j }) => !used.has(j));
  const take = (pred: (x: { s: TextSlot; j: number }) => boolean) => {
    const at = rest.findIndex(pred);
    if (at < 0) return null;
    const [x] = rest.splice(at, 1);
    used.add(x.j);
    return x.s.text;
  };
  // Сначала слоты, у которых вид известен (в компоненте есть текст): тот же вид — по порядку.
  out.forEach((v, i) => {
    const sample = slots[i].text;
    if (v !== null || !sample) return;
    out[i] = take((x) => isNumeric(x.s.text) === isNumeric(sample));
  });
  // Остальное — по порядку, что осталось.
  out.forEach((v, i) => {
    if (v === null && rest.length) out[i] = take(() => true);
  });
  return { texts: out, lost: source.filter((_, j) => !used.has(j)).map((s) => s.text) };
}

/** Иконки по порядку: для каждой иконки компонента — имя иконки фрагмента на том же месте (null — не менять). */
export function mapIcons(source: readonly string[], slots: readonly string[]): (string | null)[] {
  return slots.map((slot, i) => (i < source.length && source[i].toLowerCase() !== slot.toLowerCase() ? source[i] : null));
}
