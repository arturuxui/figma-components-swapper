import { describe, expect, it } from 'vitest';
import { lostTexts, restoreTexts, visibleTexts, type ContentNode } from '../src/core/content';

const text = (characters: string, visible = true): ContentNode => ({ type: 'TEXT', characters, visible });

describe('visibleTexts', () => {
  it('скрытые слои и их потомки не считаются, пустые тексты тоже', () => {
    const root: ContentNode = {
      type: 'INSTANCE',
      visible: false,
      children: [text('Принять заказ'), text('  '), text('скрыт', false), { type: 'FRAME', visible: false, children: [text('в скрытом')] }, { type: 'FRAME', children: [text('3 мин')] }],
    };
    expect(visibleTexts(root)).toEqual(['Принять заказ', '3 мин']);
  });
});

describe('lostTexts', () => {
  it('учитывает повторы', () => {
    expect(lostTexts(['A', 'A', 'B'], ['A', 'B', 'C'])).toEqual(['A']);
    expect(lostTexts(['A'], ['A'])).toEqual([]);
  });
});

describe('restoreTexts', () => {
  const t = (name: string, text: string, id?: string) => ({ name, text, id });

  it('пропавший текст — в слой с тем же именем, где осталась заглушка', () => {
    const before = [t('Title', 'Домой'), t('Subtitle', 'Комсомольский пр-т, 41'), t('13:46', '12 км')];
    const after = [t('Title', 'Домой', 'a1'), t('Subtitle', 'Subtitle', 'a2'), t('13:46', '12 км', 'a3')];
    expect(restoreTexts(before, after)).toEqual([{ id: 'a2', text: 'Комсомольский пр-т, 41' }]);
  });

  it('сохранённые заменой тексты не трогает', () => {
    const before = [t('Title', 'Домой'), t('Value', '12 км')];
    const after = [t('Label', 'Домой', 'a1'), t('Value', '12 км', 'a2')];
    expect(restoreTexts(before, after)).toEqual([]);
  });

  it('без однозначного имени не раскладывает по порядку (клавиатура)', () => {
    const before = [t('Key', 'Q'), t('Key', 'W'), t('Return', 'Go')];
    const after = [t('Key', 'q', 'a1'), t('Key', 'w', 'a2'), t('Label', 'return', 'a3')];
    expect(restoreTexts(before, after)).toEqual([]);
  });
});
