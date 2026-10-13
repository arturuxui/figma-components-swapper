// Доработки наших компонентов (этап 5, правила 13 и 17 скилла: нет нужного варианта / не молчать о расхождении с
// мастером). Без Figma API. Часть движка замены.
//
// Чек-лист стандартов ДС, который можно измерить: auto layout у контейнеров, цвета на переменных или стилях,
// тексты на текстовых стилях, отступы на переменных и кратные 4. Копия в макете (ручная копия нашего из 2б или
// повтор «Похож на наш») сравнивается с нашим компонентом по каждому пункту; находка — только если копия заметно
// лучше и так во всех (почти) местах: это доказательство, а не вкус.

/** Счётчики по видимым слоям узла (внутрь вложенных экземпляров не заходим — у них свой мастер). */
export interface Quality {
  /** Контейнеры с двумя и больше видимыми детьми… */
  containers: number;
  /** …из них с auto layout. */
  autoLayout: number;
  /** Видимые сплошные заливки и обводки… */
  paints: number;
  /** …на переменной или стиле цвета. */
  paintsBound: number;
  texts: number;
  /** Тексты с текстовым стилем или переменными типографики. */
  textsStyled: number;
  /** Ненулевые отступы auto layout (между элементами и внутренние)… */
  spacings: number;
  /** …на переменной… */
  spacingsBound: number;
  /** …кратные 4. */
  spacingsOn4: number;
}

export type Criterion = 'autoLayout' | 'colors' | 'textStyles' | 'spacingTokens' | 'grid4';

export const CRITERIA: Record<Criterion, { title: string; improve: string }> = {
  autoLayout: { title: 'Auto layout', improve: 'собрать контейнеры на auto layout' },
  colors: { title: 'Цвета на переменных', improve: 'привязать заливки и обводки к переменным цвета' },
  textStyles: { title: 'Текстовые стили', improve: 'применить текстовые стили' },
  spacingTokens: { title: 'Отступы на переменных', improve: 'привязать отступы к переменным' },
  grid4: { title: 'Отступы кратны 4', improve: 'выровнять отступы по сетке 4 px' },
};

/** Копия лучше нашего хотя бы на столько (доля)… */
export const GAIN_MIN = 0.5;
/** …и сама почти без нарушений. */
export const GOOD_MIN = 0.8;
/** Доля копий группы, в которых пункт лучше: иначе это случайность одного макета. */
export const GROUP_SHARE = 2 / 3;

const share = (part: number, total: number) => (total ? part / total : null);

/** Доли по пунктам чек-листа; null — пункт неприменим (нет контейнеров, цветов, текстов или отступов). */
export function scores(q: Quality): Record<Criterion, number | null> {
  return {
    autoLayout: share(q.autoLayout, q.containers),
    colors: share(q.paintsBound, q.paints),
    textStyles: share(q.textsStyled, q.texts),
    spacingTokens: share(q.spacingsBound, q.spacings),
    grid4: share(q.spacingsOn4, q.spacings),
  };
}

export interface Gain {
  criterion: Criterion;
  copy: number;
  ours: number;
}

/** Пункты, по которым копия заметно лучше нашего. */
export function gains(copy: Quality, ours: Quality): Gain[] {
  const c = scores(copy);
  const o = scores(ours);
  const out: Gain[] = [];
  for (const k of Object.keys(CRITERIA) as Criterion[]) {
    const a = c[k];
    const b = o[k];
    if (a === null || b === null) continue;
    if (a >= GOOD_MIN && a - b >= GAIN_MIN) out.push({ criterion: k, copy: a, ours: b });
  }
  return out;
}

/** Пункты, по которым копия лучше хотя бы в GROUP_SHARE мест группы; доли — по первой копии с выигрышем. */
export function groupGains(copies: readonly Quality[], ours: Quality): Gain[] {
  if (!copies.length) return [];
  const per = copies.map((q) => gains(q, ours));
  const out: Gain[] = [];
  for (const k of Object.keys(CRITERIA) as Criterion[]) {
    const hits = per.flatMap((g) => g.filter((x) => x.criterion === k));
    if (hits.length >= GROUP_SHARE * copies.length) out.push(hits[0]);
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Строка карточки: «Цвета на переменных: в макете 100 %, у нашего 20 %». */
export const gainText = (g: Gain) => `${CRITERIA[g.criterion].title}: в макете ${pct(g.copy)}, у нашего ${pct(g.ours)}`;

/** Что улучшить в нашем компоненте. */
export const improveText = (list: readonly Gain[]) => list.map((g) => CRITERIA[g.criterion].improve).join('; ');
