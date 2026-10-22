// Замер внедрения AID (AID-LU-19) по черновику методики PD: RickOBrian/aid
// `skills/_shared/notes/aid-adoption-measurement.md` v0.1.0 — §2 правила счёта, §5 формат JSON.
// Без Figma API: на вход — экземпляры верхнего уровня, собранные обходом страниц.
//
// Расхождения с методикой — решения инженера 2026-10-22 (подбирать молча нельзя):
// - `legacy` — всякий внешний компонент не из AID: Plugin API не говорит, из какой библиотеки он, поэтому `other` = 0;
// - чужая иконка — экземпляр до 48 px (у наших иконок — точно, по ключу индекса иконок);
// - `legacyWithAidAnalog` — экземпляры старых компонентов (не иконок) с уверенной парой по имени;
// - скрытые не входят в счёт, но считаются отдельно — для сверки с аудитом AID-LU-13, который их считал.

export type AdoptionSource = 'aid' | 'legacy' | 'local' | 'other';

export const ADOPTION_METHOD_VERSION = '0.1.0';
/** Иконка не из AID — экземпляр не больше такого размера, px. */
export const ADOPTION_ICON_MAX = 48;

/** Экземпляр верхнего уровня (не внутри другого экземпляра). */
export interface AdoptionItem {
  source: AdoptionSource;
  icon: boolean;
  /** Сам скрыт или в скрытом родителе. */
  hidden: boolean;
  /** Набор или компонент — для счёта уникальных. */
  unit: string;
  /** Старый компонент с уверенной парой в AID (по имени). */
  analog: boolean;
}

export type AdoptionCounts = Record<AdoptionSource, number>;

export interface AdoptionResult {
  components: AdoptionCounts;
  icons: AdoptionCounts;
  legacyWithAidAnalog: number;
  /** Скрытые — в счёт не входят. */
  hidden: { components: AdoptionCounts; icons: AdoptionCounts };
  /** Уникальные старые компоненты (не иконки) и сколько из них с парой — как в аудите AID-LU-13. */
  unique: { legacy: number; withAnalog: number };
}

const zero = (): AdoptionCounts => ({ aid: 0, legacy: 0, local: 0, other: 0 });

export function countAdoption(items: readonly AdoptionItem[]): AdoptionResult {
  const r: AdoptionResult = { components: zero(), icons: zero(), legacyWithAidAnalog: 0, hidden: { components: zero(), icons: zero() }, unique: { legacy: 0, withAnalog: 0 } };
  const legacyUnits = new Map<string, boolean>();
  for (const it of items) {
    const bucket = it.hidden ? r.hidden : r;
    bucket[it.icon ? 'icons' : 'components'][it.source]++;
    if (it.hidden || it.icon || it.source !== 'legacy') continue;
    if (it.analog) r.legacyWithAidAnalog++;
    legacyUnits.set(it.unit, (legacyUnits.get(it.unit) ?? false) || it.analog);
  }
  r.unique = { legacy: legacyUnits.size, withAnalog: [...legacyUnits.values()].filter(Boolean).length };
  return r;
}

/** Точка замера для Presentbook — строго §5: только счётчики, без процентов. */
export interface AdoptionJson {
  product: string;
  date: string;
  methodVersion: string;
  sample: { version: number; pages: { fileKey: string; page: string }[] };
  components: AdoptionCounts;
  icons: AdoptionCounts;
  legacyWithAidAnalog: number;
  source: string;
}

export function adoptionJson(r: AdoptionResult, meta: { product: string; date: string; pages: { fileKey: string; page: string }[]; source: string; sampleVersion?: number }): AdoptionJson {
  return {
    product: meta.product,
    date: meta.date,
    methodVersion: ADOPTION_METHOD_VERSION,
    sample: { version: meta.sampleVersion ?? 1, pages: meta.pages },
    components: { ...r.components },
    icons: { ...r.icons },
    legacyWithAidAnalog: r.legacyWithAidAnalog,
    source: meta.source,
  };
}

/** Экземпляр, найденный обходом страницы. */
export interface AdoptionFinding {
  componentKey: string;
  setKey?: string;
  /** Имя набора или компонента — по нему ищется пара. */
  name: string;
  remote: boolean;
  width: number;
  height: number;
  hidden: boolean;
}

/** Источник по ключу главного компонента (§2): наш индекс — AID, внешний — старая библиотека, иначе — локальный. */
export function adoptionItem(
  f: AdoptionFinding,
  aid: ReadonlyMap<string, { kind: 'components' | 'icons' }>,
  hasAnalog: (f: AdoptionFinding) => boolean,
): AdoptionItem {
  const hit = aid.get(f.componentKey) ?? (f.setKey ? aid.get(f.setKey) : undefined);
  const source: AdoptionSource = hit ? 'aid' : f.remote ? 'legacy' : 'local';
  const icon = hit ? hit.kind === 'icons' : Math.max(f.width, f.height) <= ADOPTION_ICON_MAX;
  return { source, icon, hidden: f.hidden, unit: f.setKey ?? f.componentKey, analog: source === 'legacy' && !icon && hasAnalog(f) };
}
