import { describe, expect, it } from 'vitest';
import { matchComposite, partsCover, suffixName } from '../src/core/composite';
import { INDEX_FORMAT, type IndexEntry, type LibraryIndex } from '../src/core/library-index';
import { matchManual, type ManualFinding } from '../src/core/manual';
import { buildCandidates } from '../src/core/match';
import type { Shape } from '../src/core/structure';

const shape = (textCount: number, iconCount: number, parts: string[], layoutMode = 'HORIZONTAL') => ({ layoutMode, textCount, iconCount, parts });

// Составные компоненты Driver (как в библиотеке): bar/button — 2–3 `balance`; alert — кнопки `wide`; price — `fab/primary`.
const entries: IndexEntry[] = [
  { key: 'bb-3', name: 'Items=3', setKey: 'S-bb', setName: 'bar/button', width: 328, height: 80, page: 'System', shape: shape(6, 0, ['balance', 'balance', 'balance']) },
  { key: 'bb-2', name: 'Items=2', setKey: 'S-bb', setName: 'bar/button', width: 328, height: 80, page: 'System', shape: shape(4, 0, ['balance', 'balance']) },
  { key: 'al-1', name: 'Buttons=1', setKey: 'S-al', setName: 'alert', width: 344, height: 192, page: 'Widgets', shape: shape(2, 1, ['wide'], 'VERTICAL') },
  { key: 'al-2', name: 'Buttons=2', setKey: 'S-al', setName: 'alert', width: 344, height: 192, page: 'Widgets', shape: shape(2, 1, ['wide', 'wide'], 'VERTICAL') },
  { key: 'price', name: 'price', width: 360, height: 124, page: 'Rows', shape: shape(2, 0, ['fab/primary'], 'VERTICAL') },
  { key: 'bs', name: 'Booster Section', width: 360, height: 96, page: 'Widgets', shape: shape(2, 1, ['booster'], 'VERTICAL') },
  { key: 'bs-like', name: 'promo', width: 360, height: 96, page: 'Widgets', shape: shape(2, 1, ['booster'], 'VERTICAL') },
  // сами части — обычные компоненты
  { key: 'bal', name: 'balance', width: 104, height: 64, page: 'System', shape: shape(2, 0, [], 'VERTICAL') },
];
const index: LibraryIndex = {
  format: INDEX_FORMAT,
  libraryId: 'driver-components',
  product: 'driver',
  kind: 'components',
  fileKey: 'f',
  takenAt: '',
  entries,
  sets: [
    { key: 'S-bb', name: 'bar/button', axes: { Items: ['2', '3'] }, variants: 2 },
    { key: 'S-al', name: 'alert', axes: { Buttons: ['1', '2'] }, variants: 2 },
  ],
};
const byName = buildCandidates([index]);

const frame = (name: string, width: number, height: number, s: Omit<Shape, 'width' | 'height'>, visual = true): ManualFinding => ({
  nodeId: `n-${name}`,
  name,
  screen: { id: 's', name: 'Port queue' },
  width,
  height,
  shape: { ...s, width, height },
  visual,
});

describe('partsCover', () => {
  it('все части фрейма есть в варианте — доля от большего списка', () => {
    expect(partsCover(['balance', 'balance'], ['balance', 'balance'])).toBe(1);
    expect(partsCover(['wide'], ['wide', 'wide'])).toBe(0.5);
    expect(partsCover(['Balance'], ['balance', 'divider', 'divider'])).toBeCloseTo(1 / 3);
  });
  it('часть фрейма, которой нет в варианте, — 0 (иначе она потеряется)', () => {
    expect(partsCover(['balance', 'comment'], ['balance', 'balance'])).toBe(0);
    expect(partsCover(['balance', 'balance', 'balance'], ['balance', 'balance'])).toBe(0);
    expect(partsCover([], ['balance'])).toBe(0);
  });
});

describe('suffixName', () => {
  it('имя фрейма + суффикс составного', () => {
    expect(suffixName('Booster', 'Booster Section')).toBe(true);
    expect(suffixName('🔷 booster', 'booster card')).toBe(true);
    expect(suffixName('Booster', 'Booster')).toBe(false);
    expect(suffixName('Boost', 'Booster Section')).toBe(false);
  });
});

describe('matchComposite', () => {
  it('ручная панель с тремя balance — наш bar/button (Port queue: balance panel/1. three items)', () => {
    const m = matchComposite(frame('balance panel/1. three items', 328, 80, shape(6, 0, ['balance', 'balance', 'balance'])), byName, 'driver');
    expect(m).toMatchObject({ status: 'composite', target: { key: 'S-bb' } });
    expect(m.score).toBeGreaterThanOrEqual(0.7);
  });

  it('имя с суффиксом составного — первым среди одинаково устроенных (Booster → Booster Section)', () => {
    const m = matchComposite(frame('Booster', 360, 96, shape(2, 1, ['booster'], 'VERTICAL')), byName, 'driver');
    expect(m.status).toBe('composite');
    expect(m.target?.key).toBe('bs');
    expect(m.alternatives.map((c) => c.key)).toEqual(['bs', 'bs-like']);
  });

  it('шторка с одной кнопкой wide, но другого размера — не alert (Port queue: Bottom Sheet 360×304)', () => {
    expect(matchComposite(frame('Bottom Sheet', 360, 304, shape(2, 1, ['wide'], 'VERTICAL')), byName, 'driver').status).toBe('none');
  });

  it('без своего оформления — обёртка, не составной (правило 32)', () => {
    expect(matchComposite(frame('balances', 328, 80, shape(6, 0, ['balance', 'balance', 'balance']), false), byName, 'driver').status).toBe('none');
  });

  it('без вложенных компонентов — не составной', () => {
    expect(matchComposite(frame('card', 328, 80, shape(6, 0, [])), byName, 'driver').status).toBe('none');
  });

  it('во фрейме есть компонент, которого нет в нашем, — не пара', () => {
    expect(matchComposite(frame('panel', 328, 80, shape(6, 1, ['balance', 'balance', 'comment'])), byName, 'driver').status).toBe('none');
  });

  it('другой продукт — не пара', () => {
    expect(matchComposite(frame('balance panel', 328, 80, shape(6, 0, ['balance', 'balance', 'balance'])), byName, 'rider').status).toBe('none');
  });
});

describe('matchManual → составной', () => {
  it('имени нет и устройство не «почти то же» — подбор доходит до составного', () => {
    // лишний текст и иконка: устройство похоже меньше чем на 90 % (не «Похож»), но части те же
    const m = matchManual(frame('Frame 12', 328, 88, shape(5, 1, ['balance', 'balance'])), byName, 'driver');
    expect(m).toMatchObject({ status: 'composite', target: { key: 'S-bb' } });
  });
});
