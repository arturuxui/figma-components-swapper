// Известные пары с разными именами: старое имя в макетах → имя нашего компонента. Без Figma API.
// Часть движка замены: зависит только от src/core. Пары подтверждает инженер (прогон «5б»).

/** Продукт → имя нашего компонента → старые имена, под которыми он встречается в макетах. */
export const NAME_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  rider: {
    'Status Bar iOS': ['status bar'],
    'Home Indicator iOS': ['home indicator'],
    'Keyboard - iPhone': ['iOS / System / Keyboard / Light'],
  },
};

/** Старые имена нашего компонента в продукте (без нормализации). */
export function aliasesOf(product: string, name: string, normalize: (s: string) => string): readonly string[] {
  const own = normalize(name);
  for (const [ours, old] of Object.entries(NAME_ALIASES[product] ?? {})) if (normalize(ours) === own) return old;
  return [];
}
