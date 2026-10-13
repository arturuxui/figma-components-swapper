import { describe, expect, it } from 'vitest';
import { diffText, groupOverrides, type OverrideDiff } from '../src/core/overrides';

const noBg: OverrideDiff = { layer: 'компонент', field: 'fill', from: 'Bg day/actions', to: 'нет' };
const subtitle: OverrideDiff = { layer: 'Text here', field: 'textStyle', from: 'Bodies / Body 1', to: 'Subtitles / Subtitle 1' };
const color: OverrideDiff = { layer: 'Text here', field: 'textColor', from: 'Texts day/secondary 1', to: 'Texts day/primary 1' };
const screen = (id: string) => ({ id, name: `экран ${id}` });

describe('groupOverrides', () => {
  it('одинаковые наборы расхождений — одна группа (порядок не важен), без расхождений — не в счёт', () => {
    const groups = groupOverrides('bar/slider', [
      { nodeId: '1', screen: screen('A'), diffs: [noBg] },
      { nodeId: '2', screen: screen('A'), diffs: [noBg] },
      { nodeId: '3', screen: screen('B'), diffs: [noBg] },
      { nodeId: '4', screen: screen('C'), diffs: [subtitle, color] },
      { nodeId: '5', screen: screen('C'), diffs: [color, subtitle] },
      { nodeId: '6', screen: screen('D'), diffs: [] },
    ]);
    expect(groups.map((g) => [g.count, g.screens, g.nodeIds])).toEqual([
      [3, 2, ['1', '2', '3']],
      [2, 1, ['4', '5']],
    ]);
    expect(groups[0]).toMatchObject({ groupId: 'bar/slider', exampleNodeId: '1', exampleScreen: 'экран A', diffs: [noBg] });
    expect(groups[0].id).not.toBe(groups[1].id);
  });

  it('то же расхождение у разных компонентов — разные группы (разный id)', () => {
    const a = groupOverrides('a', [{ nodeId: '1', screen: screen('A'), diffs: [noBg] }]);
    const b = groupOverrides('b', [{ nodeId: '2', screen: screen('A'), diffs: [noBg] }]);
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe('diffText', () => {
  it('слой, что расходится, было → стало', () => {
    expect(diffText(noBg)).toBe('компонент: заливка «Bg day/actions» → «нет»');
    expect(diffText(subtitle)).toBe('Text here: стиль текста «Bodies / Body 1» → «Subtitles / Subtitle 1»');
  });
});
