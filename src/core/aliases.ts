// Известные пары с разными именами: старое имя в макетах → имя нашего компонента. Без Figma API.
// Часть движка замены: зависит только от src/core. Пары подтверждает инженер (прогон «5б»).

/** Продукт → имя нашего компонента → старые имена, под которыми он встречается в макетах. */
export const NAME_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  rider: {
    'Status Bar iOS': ['status bar'],
    'Home Indicator iOS': ['home indicator'],
    'Keyboard - iPhone': ['iOS / System / Keyboard / Light'],
    // Таблица кандидатов по Where (решение инженера 2026-10-19).
    'Button Floating': ['floating'],
    'Search Capsule': ['searchfilled', 'Search'],
    'Search Field': ['Search'],
    // Навбар у нас — часть NavBar Complex (сам .NavBar скрытый).
    'NavBar Complex': ['NavBar', 'Top Actions'],
    'Button Rounded': ['Badge Map'],
    'Button Standart': ['standard'],
    'Right Element / Change Stops': ['Change Stops'],
  },
};

/** Старые имена нашего компонента в продукте (без нормализации). */
export function aliasesOf(product: string, name: string, normalize: (s: string) => string): readonly string[] {
  const own = normalize(name);
  for (const [ours, old] of Object.entries(NAME_ALIASES[product] ?? {})) if (normalize(ours) === own) return old;
  return [];
}
