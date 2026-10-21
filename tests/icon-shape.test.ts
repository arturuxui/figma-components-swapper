import { describe, expect, it } from 'vitest';
import { flattenPath, iconSimilarity, packPrint, printIcon, rankIcons, unpackPrint, type IconCandidate } from '../src/core/icon-shape';

const square = (x: number, y: number, s: number) => `M${x} ${y}L${x + s} ${y}L${x + s} ${y + s}L${x} ${y + s}Z`;
const ring = 'M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2ZM12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4Z';
/** То же кольцо, но внутренний контур в ту же сторону: nonzero дырку не вырежет. */
const ringSameDir = 'M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2ZM12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4Z';
const plus = 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z';
const cand = (key: string, d: string, evenOdd = false): IconCandidate => ({ key, name: key, print: printIcon([{ d, evenOdd }]) });

describe('flattenPath', () => {
  it('прямые, относительные команды и замыкание', () => {
    expect(flattenPath('M0 0h10v10h-10z')).toEqual([[[0, 0], [10, 0], [10, 10], [0, 10]]]);
  });
  it('кривая разбивается на отрезки и кончается в своей точке', () => {
    const [c] = flattenPath('M0 0C0 10 10 10 10 0Z');
    expect(c.length).toBeGreaterThan(4);
    expect(c[c.length - 1]).toEqual([10, 0]);
  });
});

describe('printIcon', () => {
  it('размер и положение не влияют', () => {
    expect(iconSimilarity(printIcon([{ d: ring, evenOdd: true }]), printIcon([{ d: ring, evenOdd: true, transform: [2, 0, 0, 2, 30, 7] }]))).toBeGreaterThan(0.97);
  });
  it('evenodd вырезает дырку, nonzero — нет', () => {
    const hole = printIcon([{ d: ringSameDir, evenOdd: true }]);
    const disk = printIcon([{ d: ringSameDir }]);
    expect(hole.mass).toBeLessThan(disk.mass * 0.6);
  });
  it('пустой путь — пустой отпечаток, ни с чем не похож', () => {
    const empty = printIcon([]);
    expect(empty.mass).toBe(0);
    expect(iconSimilarity(empty, printIcon([{ d: plus }]))).toBe(0);
  });
});

describe('iconSimilarity', () => {
  it('разные формы далеко, одинаковые — близко', () => {
    const a = printIcon([{ d: plus }]);
    expect(iconSimilarity(a, printIcon([{ d: plus }]))).toBeCloseTo(1, 5);
    expect(iconSimilarity(a, printIcon([{ d: ring, evenOdd: true }]))).toBeLessThan(0.5);
  });
  it('сдвиг на клетку прощается', () => {
    const a = printIcon([{ d: square(0, 0, 10) + square(14, 0, 10) }], 32, { x: 0, y: 0, width: 24, height: 24 });
    const b = printIcon([{ d: square(0.75, 0, 10) + square(14.75, 0, 10) }], 32, { x: 0, y: 0, width: 24, height: 24 });
    expect(iconSimilarity(a, b)).toBeGreaterThan(iconSimilarity(a, b, 0));
  });
});

describe('rankIcons', () => {
  const lib = [cand('plus', plus), cand('ring', ring, true), cand('square', square(4, 4, 16))];
  it('та же форма — same, своя иконка', () => {
    const m = rankIcons(printIcon([{ d: plus, transform: [0.66, 0, 0, 0.66, 0, 0] }]), lib);
    expect(m).toMatchObject({ status: 'same', target: { key: 'plus' } });
  });
  it('одноцветной иконке многоцветные не предлагаются', () => {
    const colored: IconCandidate = { ...cand('plus-color', plus), multicolor: true };
    expect(rankIcons(printIcon([{ d: plus }]), [colored], { multicolor: false }).status).toBe('none');
    expect(rankIcons(printIcon([{ d: plus }]), [colored], { multicolor: true }).target?.key).toBe('plus-color');
  });
  it('непохожая — none', () => {
    expect(rankIcons(printIcon([{ d: 'M0 0L24 0L0 24Z' }]), [lib[1]]).status).toBe('none');
  });
  it('двойники: ближе по размеру рисунка, потом по имени', () => {
    const twins: IconCandidate[] = [
      { ...cand('plus-16', plus), name: 'plus', glyph: { width: 16, height: 16 } },
      { ...cand('plus-24', plus), name: 'plus', glyph: { width: 24, height: 24 } },
    ];
    expect(rankIcons(printIcon([{ d: plus }]), twins, { glyph: { width: 23, height: 23 } }).target?.key).toBe('plus-24');
    const named: IconCandidate[] = [{ ...cand('a', plus), name: 'add' }, { ...cand('b', plus), name: 'plus' }];
    expect(rankIcons(printIcon([{ d: plus }]), named, { name: '24/Stroke/plus' }).target?.key).toBe('b');
    expect(rankIcons(printIcon([{ d: plus }]), named).disputed).toBe(true);
  });
});

describe('packPrint', () => {
  it('туда и обратно — та же форма', () => {
    const p = printIcon([{ d: ring, evenOdd: true }]);
    const packed = packPrint(p);
    expect(packed.length).toBe(684);
    expect(iconSimilarity(p, unpackPrint(packed))).toBeGreaterThan(0.97);
  });
});
