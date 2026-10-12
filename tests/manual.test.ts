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

  it('одно имя и размер, но разное устройство — разные группы (пара подбирается по первому фрейму)', () => {
    const groups = groupManual([
      finding('balance panel', 328, 80, shape(3, 2, 'NONE', ['balance', 'balance', 'balance'])),
      { ...finding('balance panel', 328, 80, shape(3, 0, 'NONE', ['balance', 'balance', 'balance'])), nodeId: 'no-icons' },
      { ...finding('balance panel', 328, 80, shape(3, 2, 'NONE', ['Balance', 'balance', 'balance'])), nodeId: 'same' },
    ]);
    expect(groups.map((g) => g.nodeIds)).toEqual([['n-balance panel-328', 'same'], ['no-icons']]);
  });
});

describe('matchManual — ничья по устройству решается размером', () => {
  // Карточка тарифа и отзыв устроены одинаково (текст + иконка, без раскладки), размеры разные.
  const cards: LibraryIndex = {
    ...index,
    entries: [
      { key: 'tariff', name: 'tariff', width: 158, height: 148, page: 'Cards', shape: shape(1, 1, 'NONE') },
      { key: 'review', name: 'review', width: 128, height: 160, page: 'Cards', shape: shape(1, 1, 'NONE') },
    ],
    sets: [],
  };
  const cardsByName = buildCandidates([cards]);

  it('карточка 158×148 — tariff того же размера, а не review 128×160 (Port queue: Frame 498)', () => {
    const m = matchManual(finding('Frame 498', 158, 148, shape(1, 1, 'NONE')), cardsByName, 'driver');
    expect(m).toMatchObject({ status: 'similar', target: { key: 'tariff' } });
    expect(m.alternatives.map((c) => c.key)).toEqual(['tariff', 'review']);
  });

  it('размер посередине — оба далеко, ничья остаётся: не пара', () => {
    expect(matchManual(finding('Frame 1', 143, 154, shape(1, 1, 'NONE')), cardsByName, 'driver').status).toBe('none');
  });

  it('размер почти тот же у обоих — ничья остаётся (двойники info и subtitle)', () => {
    expect(matchManual(finding('Frame 2', 360, 56, shape(2, 1)), byName, 'driver').status).toBe('none');
  });
});

describe('matchManual — горизонтальный компонент по имени растёт по тексту', () => {
  const badges: LibraryIndex = {
    ...index,
    entries: [{ key: 'mc', name: 'medium/color', width: 189, height: 40, page: 'Badges', shape: shape(1, 1, 'HORIZONTAL') }],
    sets: [],
  };
  const badgesByName = buildCandidates([badges]);

  it('бейдж с тем же именем уже нашего (86×44 против 189×40) — named (Port queue: medium/color)', () => {
    const m = matchManual(finding('medium/color', 86, 44, shape(1, 0, 'HORIZONTAL')), badgesByName, 'driver');
    expect(m).toMatchObject({ status: 'named', target: { key: 'mc' } });
  });

  it('высота другая — не пара', () => {
    expect(matchManual(finding('medium/color', 86, 64, shape(1, 0, 'HORIZONTAL')), badgesByName, 'driver').status).toBe('none');
  });

  it('фрейм не горизонтальный — ширина сравнивается как раньше', () => {
    expect(matchManual(finding('medium/color', 86, 44, shape(1, 0, 'NONE')), badgesByName, 'driver').status).toBe('none');
  });

  it('без имени ширина по-прежнему важна — не similar', () => {
    expect(matchManual(finding('Frame 3', 86, 44, shape(1, 1, 'HORIZONTAL')), badgesByName, 'driver').status).toBe('none');
  });
});
