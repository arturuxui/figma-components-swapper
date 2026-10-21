import { describe, expect, it } from 'vitest';
import { INDEX_FORMAT, type LibraryIndex } from '../src/core/library-index';
import { buildCandidates, guessProduct, iconCandidates, matchByName, matchIcon, normalizeName, resolveChoice, sizeDistance } from '../src/core/match';
import { packPrint, printIcon } from '../src/core/icon-shape';
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

describe('resolveChoice', () => {
  const alts = byName.get('fab/secondary')!;
  it('ключ набора — набор целиком, ключ варианта — этот вариант', () => {
    expect(alts[0].variants?.map((v) => v.name)).toEqual(['Text=No', 'Text=Yes']);
    expect(resolveChoice(alts, 'S-fab')?.target).toEqual({ key: 'S-fab', isSet: true });
    expect(resolveChoice(alts, 'fab-yes')).toMatchObject({ owner: { key: 'S-fab' }, target: { key: 'fab-yes', isSet: false } });
    expect(resolveChoice(alts, 'nope')).toBeNull();
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

describe('известные пары с разными именами', () => {
  const riderComponents = index('rider-components', 'rider', 'components', {
    entries: [
      { key: 'r-sb', name: 'Status Bar iOS', width: 390, height: 54, page: 'System Elements' },
      { key: 'r-kb', name: 'Keyboard - iPhone', width: 390, height: 336, page: 'System Elements' },
    ],
  });
  const both = buildCandidates([driverComponents, riderComponents]);

  it('старое имя находит наш компонент своего продукта', () => {
    expect(matchByName('status bar', { width: 390, height: 54 }, both, 'rider')).toMatchObject({ status: 'exact', target: { key: 'r-sb' } });
    expect(matchByName('iOS / System / Keyboard / Light', { width: 390, height: 336 }, both, 'rider')).toMatchObject({ status: 'exact', target: { key: 'r-kb' } });
  });

  it('в другом продукте пара не действует', () => {
    expect(matchByName('status bar', { width: 390, height: 54 }, both, 'driver').status).toBe('none');
  });

  it('одно старое имя — к двум нашим: выбор по размеру, а если оба подходят — дизайнер', () => {
    const search = index('rider-components', 'rider', 'components', {
      entries: [
        { key: 'r-field', name: 'Search Field', width: 390, height: 60, page: 'Search' },
        { key: 'r-capsule', name: 'Search Capsule', width: 384, height: 52, page: 'Search' },
      ],
    });
    const m = matchByName('Search', { width: 390, height: 62 }, buildCandidates([search]), 'rider');
    expect(m.status).toBe('ambiguous');
    expect(m.alternatives[0].key).toBe('r-field');
  });

  it('своё имя по-прежнему находится', () => {
    expect(matchByName('Status Bar iOS', { width: 390, height: 54 }, both, 'rider').target?.key).toBe('r-sb');
  });
});

describe('matchIcon — иконки по рисунку', () => {
  const plus = 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z';
  const ring = 'M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2ZM12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4Z';
  const entry = (key: string, name: string, d: string, evenOdd = false) => ({
    key, name, width: 24, height: 24, page: 'Icons',
    icon: { print: packPrint(printIcon([{ d, evenOdd }])) },
  });
  const icons = index('rider-icons', 'rider', 'icons', { entries: [entry('i-plus', 'ic_plus', plus), entry('i-ring', 'ic_circle', ring, true)] });
  const all = iconCandidates(buildCandidates([icons]), 'rider');

  it('тот же рисунок под другим именем — drawn', () => {
    const m = matchIcon({ print: printIcon([{ d: plus, transform: [0.5, 0, 0, 0.5, 3, 3] }]), multicolor: false, name: '24/Stroke/add' }, all);
    expect(m).toMatchObject({ status: 'drawn', target: { key: 'i-plus' } });
  });
  it('многоцветная — даже тот же силуэт только предложение', () => {
    const m = matchIcon({ print: printIcon([{ d: plus }]), multicolor: true, name: 'logo' }, all);
    expect(m.status).toBe('shape');
  });
  it('непохожий рисунок — none', () => {
    expect(matchIcon({ print: printIcon([{ d: 'M0 0L24 0L0 24Z' }]), multicolor: false, name: 'x' }, all).status).toBe('none');
  });
  describe('одноимённая иконка — первой', () => {
    const frame = (w: number) => `M2 2H22V22H2ZM${2 + w} ${2 + w}H${22 - w}V${22 - w}H${2 + w}Z`;
    const lib = (waitDrawing: string) =>
      iconCandidates(buildCandidates([index('rider-icons', 'rider', 'icons', { entries: [entry('i-wait', 'ic_wait', waitDrawing, true), entry('i-parking', 'ic_parking', 'M2 2H22V22H2Z')] })]), 'rider');
    const layout = (name: string) => ({ print: printIcon([{ d: frame(6), evenOdd: true }]), multicolor: false, name });

    it('похожа меньше чужой — всё равно первая, решает дизайнер', () => {
      const m = matchIcon(layout('ic_wait'), lib(frame(4)));
      expect(m).toMatchObject({ status: 'shape', target: { key: 'i-wait' } });
      expect(m.alternatives.map((c) => c.key)).toEqual(['i-wait', 'i-parking']);
    });
    it('имя сравнивается без приставок: «Icon / Wait» = «ic_wait»', () => {
      expect(matchIcon(layout('Icon / Wait'), lib(frame(4))).target?.key).toBe('i-wait');
    });
    it('совсем другой рисунок — одноимённую не предлагаем первой', () => {
      expect(matchIcon(layout('Icon / Wait'), lib(frame(2))).target?.key).toBe('i-parking');
    });
  });
  it('иконки другого продукта не участвуют', () => {
    expect(iconCandidates(buildCandidates([icons]), 'driver')).toEqual([]);
  });
});
