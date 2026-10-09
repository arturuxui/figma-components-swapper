import { describe, expect, it } from 'vitest';
import { INDEX_FORMAT, type IndexEntry, type LibraryIndex } from '../src/core/library-index';
import { groupManual, matchManual, type ManualFinding } from '../src/core/manual';
import { buildCandidates } from '../src/core/match';
import type { Shape } from '../src/core/structure';

const shape = (textCount: number, iconCount: number, layoutMode = 'HORIZONTAL', parts: string[] = []) => ({ layoutMode, textCount, iconCount, parts });

const entries: IndexEntry[] = [
  // Selection Control: заголовок + чекбокс + иконка в кружке
  { key: 'sc-f', name: 'Checked=False', setKey: 'S-sc', setName: 'Selection Control', width: 328, height: 72, page: 'Controls', shape: shape(1, 2, 'NONE') },
  { key: 'sc-t', name: 'Checked=True', setKey: 'S-sc', setName: 'Selection Control', width: 328, height: 72, page: 'Controls', shape: shape(1, 2, 'NONE') },
  // полоска прогресса
  { key: 'pr', name: 'Size=M', setKey: 'S-pr', setName: 'progress', width: 100, height: 8, page: 'Widgets', shape: shape(0, 0, 'NONE') },
  // карточка тарифа и похожая на неё строка
  { key: 'tarif', name: 'tarif', width: 360, height: 64, page: 'Rows', shape: shape(2, 1, 'HORIZONTAL', ['booster']) },
  { key: 'info', name: 'info', width: 360, height: 56, page: 'Rows', shape: shape(2, 1, 'HORIZONTAL') },
  // устроен так же, как info, — двойник
  { key: 'subtitle', name: 'subtitle', width: 360, height: 56, page: 'Rows', shape: shape(2, 1, 'HORIZONTAL') },
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
    { key: 'S-sc', name: 'Selection Control', axes: {}, variants: 2 },
    { key: 'S-pr', name: 'progress', axes: {}, variants: 1 },
  ],
};
const byName = buildCandidates([index]);

const finding = (name: string, width: number, height: number, s: Omit<Shape, 'width' | 'height'>, visual = true): ManualFinding => ({
  nodeId: `n-${name}-${width}`,
  name,
  screen: { id: 's', name: 'Order' },
  width,
  height,
  shape: { ...s, width, height },
  visual,
});

describe('matchManual', () => {
  it('имя совпало и устройство похоже — named (ручной Selection Control из «📍 Order»)', () => {
    const m = matchManual(finding('Selection Control', 328, 62, shape(1, 1, 'VERTICAL')), byName, 'driver');
    expect(m.status).toBe('named');
    expect(m.target?.key).toBe('S-sc');
    expect(m.score).toBeGreaterThanOrEqual(0.7);
  });

  it('имя совпало, но размер другой — не пара (омоним progress 60×40)', () => {
    expect(matchManual(finding('progress', 60, 40, shape(1, 1), false), byName, 'driver').status).toBe('none');
  });

  it('имени нет, своё оформление, устройство почти то же — similar', () => {
    const m = matchManual(finding('Frame 2131330712', 360, 64, shape(2, 1, 'HORIZONTAL', ['booster'])), byName, 'driver');
    expect(m).toMatchObject({ status: 'similar', target: { key: 'tarif' } });
  });

  it('имени нет и всего один текст на подложке — не предлагаем (подпись-аннотация «Скролл»)', () => {
    expect(matchManual(finding('Frame 2131330712', 94, 40, shape(1, 0)), byName, 'driver').status).toBe('none');
  });

  it('имени нет и нет оформления (чистая обёртка) — не предлагаем', () => {
    expect(matchManual(finding('Content', 360, 64, shape(2, 1, 'HORIZONTAL', ['booster']), false), byName, 'driver').status).toBe('none');
  });

  it('имени нет и два наших компонента одинаково похожи — не предлагаем (нет отрыва)', () => {
    expect(matchManual(finding('Row', 360, 60, shape(2, 1, 'HORIZONTAL')), byName, 'driver').status).toBe('none');
  });
});

describe('groupManual', () => {
  it('одно имя и близкий размер — одна группа', () => {
    const groups = groupManual([
      finding('Selection Control', 328, 62, shape(1, 1)),
      { ...finding('Selection Control', 328, 63, shape(1, 1)), nodeId: 'other' },
      finding('Selection Control', 328, 120, shape(1, 1)),
    ]);
    expect(groups.map((g) => [g.count, g.manual])).toEqual([
      [2, true],
      [1, true],
    ]);
  });
});
