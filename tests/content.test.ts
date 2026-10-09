import { describe, expect, it } from 'vitest';
import { lostTexts, visibleTexts, type ContentNode } from '../src/core/content';

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
