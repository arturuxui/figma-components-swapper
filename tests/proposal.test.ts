import { describe, expect, it } from 'vitest';
import { improvementText, proposalText } from '../src/core/proposal';
import type { RepeatGroup } from '../src/core/repeats';

const repeat = (over: Partial<RepeatGroup> = {}): RepeatGroup => ({
  id: 'r:x',
  name: 'Slider open',
  count: 31,
  screens: 31,
  nodeIds: [],
  exampleNodeId: '1:1',
  exampleScreen: 'layers',
  width: 328,
  height: 401,
  texts: 11,
  icons: 7,
  parts: ['bar/slider', 'bar/slider', 'dividers/middle/padding16'],
  varying: { texts: 7, icons: 2 },
  varyingAt: { texts: [0, 1, 2, 3, 4, 5, 6], icons: [1, 3] },
  ...over,
});

describe('proposalText', () => {
  it('меню статусов с «Port queue»: где, сколько, свойства, из чего собран', () => {
    expect(proposalText(repeat())).toEqual({
      title: 'Slider open',
      meta: '×31 · 31 экран · 328×401',
      props: 'Свойства: 7 текстов, 2 иконки (замена)',
      why: 'Одинаковое устройство в 31 месте на 31 экране; собран из наших: bar/slider, dividers/middle/padding16. Среди наших компонентов похожего нет',
    });
  });

  it('все копии одинаковые и похож на наш — так и пишем', () => {
    const t = proposalText(repeat({ name: 'Frame 500', count: 15, screens: 5, parts: [], varyingAt: { texts: [], icons: [] }, likeOurs: 'tariff' }));
    expect(t.meta).toBe('×15 · 5 экранов · 328×401');
    expect(t.props).toBe('Свойства: нет — все копии одинаковые');
    expect(t.why).toContain('Похож на наш «tariff»');
  });

  it('варианты одного кандидата — строкой с осью «Вид»', () => {
    const main = repeat({ name: 'Bottom Sheet', count: 22, width: 360, height: 340, variant: 'Основной' });
    const v = repeat({ name: 'Bottom Sheet', count: 11, width: 360, height: 326, variant: 'С «Вы 5-й в очереди»', variantOf: main.id });
    expect(proposalText(main, [v]).variants).toBe('Варианты (Вид): Основной ×22 · 360×340; С «Вы 5-й в очереди» ×11 · 360×326');
    expect(proposalText(main).variants).toBeUndefined();
  });
});

describe('improvementText', () => {
  it('доработка: где, сколько, что изменено и почему', () => {
    const t = improvementText(
      { id: 'o:x', groupId: 'x', count: 170, screens: 39, nodeIds: [], exampleNodeId: '1:1', exampleScreen: 's', diffs: [{ layer: 'компонент', field: 'fill', from: 'Bg day/actions', to: 'нет' }] },
      'bar/slider',
    );
    expect(t.title).toBe('Доработка · bar/slider');
    expect(t.meta).toBe('×170 · 39 экранов');
    expect(t.changes).toEqual(['компонент: заливка «Bg day/actions» → «нет»']);
    expect(t.why).toContain('170 экземпляров «bar/slider» на 39 экранах');
  });
});
