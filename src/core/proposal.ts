// Предложение нового компонента по повтору (этап 4, правило 26 скилла: предлагать недостающие компоненты с
// обоснованием). Без Figma API: только тексты карточки; черновик и страницу делает src/figma/propose.ts.
//
// Куда отправлять предложения, решает PD (RickOBrian/aid#185); пока — карточки на странице в файле макета.

import { diffText, type OverrideGroup } from './overrides';
import type { RepeatGroup } from './repeats';

export const PROPOSALS_PAGE = 'Components Swapper · Предложения';

export interface ProposalText {
  title: string;
  /** «×31 · экранов 31 · 328×401». */
  meta: string;
  /** Какие свойства будут у компонента. */
  props: string;
  /** Почему это кандидат. */
  why: string;
  /** Варианты одного кандидата — «Вид = …: ×мест · размер»; нет вариантов — undefined. */
  variants?: string;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Ось вариантов в наборе-черновике. */
export const VARIANT_AXIS = 'Вид';

export function proposalText(r: RepeatGroup, variants: readonly RepeatGroup[] = []): ProposalText {
  const props = [
    r.varyingAt.texts.length && `${r.varyingAt.texts.length} ${plural(r.varyingAt.texts.length, 'текст', 'текста', 'текстов')}`,
    r.varyingAt.icons.length && `${r.varyingAt.icons.length} ${plural(r.varyingAt.icons.length, 'иконка', 'иконки', 'иконок')} (замена)`,
  ].filter(Boolean);
  const parts = [...new Set(r.parts)];
  return {
    title: r.name,
    meta: `×${r.count} · ${r.screens} ${plural(r.screens, 'экран', 'экрана', 'экранов')} · ${Math.round(r.width)}×${Math.round(r.height)}`,
    props: props.length ? `Свойства: ${props.join(', ')}` : 'Свойства: нет — все копии одинаковые',
    why:
      `Одинаковое устройство в ${r.count} ${plural(r.count, 'месте', 'местах', 'местах')} на ${r.screens} ${plural(r.screens, 'экране', 'экранах', 'экранах')}` +
      (parts.length ? `; собран из наших: ${parts.join(', ')}` : '') +
      (r.likeOurs ? `. Похож на наш «${r.likeOurs}» — сначала проверьте, не его ли это копия` : '. Среди наших компонентов похожего нет'),
    variants: variants.length
      ? `Варианты (${VARIANT_AXIS}): ` + [r, ...variants].map((v) => `${v.variant ?? v.name} ×${v.count} · ${Math.round(v.width)}×${Math.round(v.height)}`).join('; ')
      : undefined,
  };
}

/** Карточка доработки нашего компонента (этап 5): расхождение, по которому пользователь решил «нужен вариант». */
export interface ImprovementText {
  title: string;
  /** «×170 · 39 экранов». */
  meta: string;
  /** Что изменено в макете — по строке на расхождение. */
  changes: string[];
  why: string;
}

/** Правила 13 и 17 скилла: нет нужного варианта — не молчать, а предложить доработку с доказательством. */
export function improvementText(o: OverrideGroup, ours: string): ImprovementText {
  return {
    title: `Доработка · ${ours}`,
    meta: `×${o.count} · ${o.screens} ${plural(o.screens, 'экран', 'экрана', 'экранов')}`,
    changes: o.diffs.map(diffText),
    why:
      `В макете ${o.count} ${plural(o.count, 'экземпляр', 'экземпляра', 'экземпляров')} «${ours}» на ${o.screens} ${plural(o.screens, 'экране', 'экранах', 'экранах')} ` +
      `изменены одинаково. Пользователь решил: это не ошибка макета — компоненту нужен вариант. При замене изменение перенесено ` +
      `переопределением; библиотеку плагин не меняет`,
  };
}
