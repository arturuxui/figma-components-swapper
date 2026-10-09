import { describe, expect, it } from 'vitest';
import { mapIcons, mapTexts, pickByStructure, signature, structureScore, type StructNode } from '../src/core/structure';

const text = (name: string, characters: string, visible = true): StructNode => ({ type: 'TEXT', name, characters, visible, width: 100, height: 20 });
const icon = (mainName: string, visible = true): StructNode => ({ type: 'INSTANCE', name: 'icon', mainName, visible, width: 24, height: 24 });
const frame = (name: string, w: number, h: number, children: StructNode[], layoutMode = 'HORIZONTAL'): StructNode => ({ type: 'FRAME', name, width: w, height: h, layoutMode, children });

// Отвязанный bar/button из «📍 Order»: три кнопки, вторая — отвязанная, с отвязанной иконкой wallet.
const detachedBar = frame('bar/button', 328, 80, [
  { type: 'INSTANCE', name: 'button', mainName: 'balance', width: 104, height: 56, children: [icon('menu'), text('✏️ Text here', 'Меню')] },
  frame('button 2', 104, 56, [frame('wallet', 24, 24, [{ type: 'VECTOR', name: 'v', width: 20, height: 18 }], 'NONE'), text('✏️ Text here', 'Деньги')], 'NONE'),
  { type: 'INSTANCE', name: 'button', mainName: 'balance', width: 104, height: 56, children: [icon('newspaper'), text('✏️ Text here', 'Новости')] },
]);
const variant = (texts: string[], icons: string[]) =>
  frame(
    'v',
    328,
    80,
    texts.map((t, i) => ({ type: 'INSTANCE', name: 'b', mainName: 'balance', width: 104, height: 56, children: [icon(icons[i]), text('✏️ Text here', t)] })),
  );

describe('signature', () => {
  it('тексты, иконки (и отвязанная иконка по имени фрейма), вложенные компоненты; скрытое не считается', () => {
    const sig = signature(detachedBar);
    expect(sig.texts.map((t) => t.text)).toEqual(['Меню', 'Деньги', 'Новости']);
    expect(sig.icons).toEqual(['menu', 'wallet', 'newspaper']);
    expect(sig.parts).toEqual(['balance', 'balance']);
    const hidden = signature(frame('x', 10, 10, [text('a', 'видно'), text('b', 'скрыто', false), icon('close', false)]));
    expect(hidden.texts.map((t) => t.text)).toEqual(['видно']);
    expect(hidden.icons).toEqual([]);
  });
});

describe('pickByStructure', () => {
  it('выбирает вариант с тем же числом текстов и иконок', () => {
    const two = signature(variant(['Пополнить', 'Перевести'], ['arrow_down_round', 'arrow_right_round']));
    const three = signature(variant(['Меню', 'Предзаказы', 'Новости'], ['menu', 'time_round', 'newspaper']));
    expect(pickByStructure(signature(detachedBar), [two, three]).index).toBe(1);
  });

  it('одинаковые устройства — похожесть 1', () => {
    const s = signature(detachedBar);
    expect(structureScore(s, s)).toBeCloseTo(1);
  });
});

describe('mapTexts', () => {
  it('сначала по единственному совпавшему имени, остальные по порядку', () => {
    const source = [
      { name: '✏️ Title', text: 'Мотивация' },
      { name: '✏️ Title', text: '– 12 баллов' },
      { name: '68', text: '68' },
      { name: '✏️ Description', text: 'При падении' },
    ];
    const slots = [{ name: '✏️ Title' }, { name: '✏️ Title' }, { name: 'Count' }, { name: '✏️ Description' }];
    expect(mapTexts(source, slots)).toEqual({ texts: ['Мотивация', '– 12 баллов', '68', 'При падении'], lost: [] });
  });

  it('число — в числовой слот, слово — в текстовый (push/motivation: старый Increase → наш Increased)', () => {
    const source = [
      { name: '✏️ Title', text: 'Мотивация' },
      { name: '✏️ Title', text: '+ 12 баллов' },
      { name: '68', text: '68' },
      { name: '✏️ Description', text: 'За выполненный заказ' },
    ];
    const slots = [
      { name: 'Count', text: '100' },
      { name: '✏️ Title', text: 'Мотивация повышена' },
      { name: '✏️ Description', text: 'За выполненный зак' },
    ];
    expect(mapTexts(source, slots)).toEqual({ texts: ['68', 'Мотивация', 'За выполненный заказ'], lost: ['+ 12 баллов'] });
  });

  it('слотов меньше — лишние тексты в lost; больше — остаются как в компоненте', () => {
    expect(mapTexts([{ name: 'a', text: '1' }, { name: 'b', text: '2' }], [{ name: 'x' }])).toEqual({ texts: ['1'], lost: ['2'] });
    expect(mapTexts([{ name: 'a', text: '1' }], [{ name: 'x' }, { name: 'y' }])).toEqual({ texts: ['1', null], lost: [] });
  });
});

describe('mapIcons', () => {
  it('меняет только отличающиеся иконки на тех же местах', () => {
    expect(mapIcons(['menu', 'wallet', 'newspaper'], ['menu', 'time_round', 'newspaper'])).toEqual([null, 'wallet', null]);
    expect(mapIcons(['a'], ['b', 'c'])).toEqual(['a', null]);
  });
});
