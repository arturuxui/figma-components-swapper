// Выбор варианта нашего набора по вариантам старого экземпляра (правило 28 скилла).
// Без Figma API. Часть движка замены.

export type VariantProps = Record<string, string>;

export interface VariantPick {
  /** Индекс выбранного варианта; -1 — вариант по умолчанию. */
  index: number;
  /** Сколько осей совпало. */
  matched: number;
  /** Оси старого экземпляра, которых нет у нашего набора или значение не нашлось. */
  unmatched: string[];
}

const lower = (props: VariantProps | null | undefined) =>
  new Map(Object.entries(props ?? {}).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim().toLowerCase()]));

/**
 * Вариант, у которого больше всего осей совпало со старым (без регистра). Ничья — первый по порядку набора.
 * Ни одна ось не совпала — вариант по умолчанию.
 */
export function pickVariant(old: VariantProps | null | undefined, variants: readonly VariantProps[]): VariantPick {
  const want = lower(old);
  let index = -1;
  let matched = 0;
  variants.forEach((v, i) => {
    let n = 0;
    for (const [axis, value] of lower(v)) if (want.get(axis) === value) n++;
    if (n > matched) {
      matched = n;
      index = i;
    }
  });
  const chosen = index >= 0 ? lower(variants[index]) : new Map<string, string>();
  const unmatched = Object.keys(old ?? {}).filter((axis) => {
    const k = axis.trim().toLowerCase();
    return chosen.get(k) !== want.get(k);
  });
  return { index, matched, unmatched };
}
