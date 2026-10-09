import { describe, expect, it } from 'vitest';
import { INDEX_FORMAT, type LibraryIndex } from '../src/core/library-index';
import { buildCandidates, guessProduct, matchByName, normalizeName, sizeDistance } from '../src/core/match';
import { pickVariant } from '../src/core/variants';

const index = (libraryId: string, product: string, kind: 'components' | 'icons', partial: Partial<LibraryIndex>): LibraryIndex => ({
  format: INDEX_FORMAT,
  libraryId,
  product,
  kind,
  fileKey: libraryId,
  takenAt: '2026-10-09T00:00:00Z',
  entries: [],
  sets: [],
  ...partial,
});

const driverComponents = index('driver-components', 'driver', 'components', {
  sets: [
    { key: 'S-fab', name: 'fab/secondary', axes: { Text: ['No', 'Yes'] }, variants: 2 },
    { key: 'S-default-btn', name: 'default', axes: {}, variants: 1 },
    { key: 'S-default-dialog', name: 'default', axes: {}, variants: 1 },
    { key: 'S-status', name: ' StatusInfo', axes: {}, variants: 1 },
  ],
  entries: [
    { key: 'fab-no', name: 'Text=No', setKey: 'S-fab', setName: 'fab/secondary', width: 56, height: 56, page: 'Buttons' },
    { key: 'fab-yes', name: 'Text=Yes', setKey: 'S-fab', setName: 'fab/secondary', width: 120, height: 56, page: 'Buttons' },
    { key: 'btn', name: 'State=Default', setKey: 'S-default-btn', setName: 'default', width: 328, height: 48, page: 'Buttons' },
    { key: 'dlg', name: 'State=Default', setKey: 'S-default-dialog', setName: 'default', width: 360, height: 400, page: 'Dialogues' },
    { key: 'st', name: 'State=Default', setKey: 'S-status', setName: ' StatusInfo', width: 360, height: 64, page: 'Widgets' },
    { key: 'desc', name: 'description', width: 360, height: 40, page: 'System' },
  ],
});
const driverIcons = index('driver-icons', 'driver', 'icons', { entries: [{ key: 'i-check', name: 'check_round', width: 24, height: 24, page: 'Icons' }] });
const riderIcons = index('rider-icons', 'rider', 'icons', { entries: [{ key: 'r-check', name: 'check_round', width: 24, height: 24, page: 'Icons' }] });
const byName = buildCandidates([driverComponents, driverIcons, riderIcons]);

describe('normalizeName', () => {
  it('убирает регистр, эмодзи и знаки в начале, пробелы вокруг /', () => {
    expect(normalizeName('🔷 push / Android')).toBe('push/android');
    expect(normalizeName(' StatusInfo')).toBe('statusinfo');
    expect(normalizeName('Fab /  Secondary')).toBe('fab/secondary');
    expect(normalizeName('no  smoking')).toBe('no smoking');
  });
});

describe('sizeDistance', () => {
  it('берёт ближайший вариант набора', () => {
    const fab = byName.get('fab/secondary')![0];
    expect(sizeDistance({ width: 120, height: 56 }, fab)).toBe(0);
    expect(sizeDistance({ width: 60, height: 56 }, fab)).toBeCloseTo(4 / 60);
  });
});

describe('matchByName', () => {
  it('одно имя и подходящий размер — exact', () => {
    const m = matchByName('fab/secondary', { width: 56, height: 56 }, byName, 'driver');
    expect(m).toMatchObject({ status: 'exact', target: { key: 'S-fab', isSet: true } });
  });

  it('имя без пробела в начале находит набор с пробелом', () => {
    expect(matchByName('StatusInfo', { width: 360, height: 64 }, byName, 'driver').target?.key).toBe('S-status');
  });

  it('имя совпало, размер нет — size', () => {
    expect(matchByName('description', { width: 47, height: 32 }, byName, 'driver').status).toBe('size');
  });

  it('растянут по ширине при той же высоте — stretched', () => {
    expect(matchByName('description', { width: 1200, height: 40 }, byName, 'driver')).toMatchObject({ status: 'stretched', target: { key: 'desc' } });
    expect(matchByName('description', { width: 200, height: 40.6 }, byName, 'driver').status).toBe('stretched');
  });

  it('растяжение не подходит: выросла высота, квадратный компонент, одноимённые', () => {
    // высота отличается больше чем на 1 px
    expect(matchByName('description', { width: 1200, height: 44 }, byName, 'driver').status).toBe('size');
    // квадратная иконка, растянутая по ширине, — не растяжение
    expect(matchByName('check_round', { width: 60, height: 24 }, byName, 'driver').status).toBe('size');
    // одноимённые не разводятся растяжением
    expect(matchByName('default', { width: 600, height: 48 }, byName, 'driver').status).toBe('ambiguous');
  });

  it('одноимённые разводятся размером', () => {
    expect(matchByName('default', { width: 328, height: 48 }, byName, 'driver').target?.key).toBe('S-default-btn');
    expect(matchByName('default', { width: 360, height: 420 }, byName, 'driver').target?.key).toBe('S-default-dialog');
  });

  it('одноимённые без подходящего размера — ambiguous, ближайшие первыми', () => {
    const m = matchByName('default', { width: 200, height: 200 }, byName, 'driver');
    expect(m.status).toBe('ambiguous');
    expect(m.target).toBeUndefined();
    expect(m.alternatives.map((c) => c.key)).toEqual(['S-default-dialog', 'S-default-btn']);
  });

  it('продукт отсекает одноимённые из другого продукта', () => {
    expect(matchByName('check_round', { width: 24, height: 24 }, byName, 'rider').target?.key).toBe('r-check');
    expect(matchByName('check_round', { width: 24, height: 24 }, byName).status).toBe('ambiguous');
  });

  it('нет такого имени — none', () => {
    expect(matchByName('bg', { width: 360, height: 720 }, byName, 'driver')).toEqual({ status: 'none', alternatives: [] });
  });
});

describe('guessProduct', () => {
  it('продукт с большим числом мест, нашедших пару', () => {
    const groups = [
      { name: 'fab/secondary', count: 30 },
      { name: 'check_round', count: 5 },
      { name: 'bg', count: 100 },
    ];
    expect(guessProduct(groups, byName)).toBe('driver');
  });
});

describe('pickVariant', () => {
  const variants = [
    { Type: 'Order', Comment: 'False', Entrance: 'True' },
    { Type: 'Offer', Comment: 'False', Entrance: 'False' },
    { Type: 'Order', Comment: 'False', Entrance: 'False' },
  ];

  it('все оси совпали', () => {
    expect(pickVariant({ Type: 'Order', Comment: 'False', Entrance: 'False' }, variants)).toEqual({ index: 2, matched: 3, unmatched: [] });
  });

  it('без регистра; несовпавшие оси — в отчёт', () => {
    expect(pickVariant({ type: 'offer', Destructive: 'True' }, variants)).toEqual({ index: 1, matched: 1, unmatched: ['Destructive'] });
  });

  it('ничего не совпало или нет вариантов у старого — по умолчанию', () => {
    expect(pickVariant({ Size: 'L' }, variants)).toEqual({ index: -1, matched: 0, unmatched: ['Size'] });
    expect(pickVariant(null, variants)).toEqual({ index: -1, matched: 0, unmatched: [] });
  });
});
