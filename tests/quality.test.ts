import { describe, expect, it } from 'vitest';
import { gainText, groupGains, gains, scores, type Quality } from '../src/core/quality';

const q = (over: Partial<Quality> = {}): Quality => ({ containers: 2, autoLayout: 2, paints: 4, paintsBound: 4, texts: 2, textsStyled: 2, spacings: 4, spacingsBound: 4, spacingsOn4: 4, ...over });

describe('quality', () => {
  it('доли по пунктам; пункт без слоёв — null', () => {
    expect(scores(q({ paintsBound: 1, texts: 0, textsStyled: 0 }))).toEqual({ autoLayout: 1, colors: 0.25, textStyles: null, spacingTokens: 1, grid4: 1 });
  });

  it('находка — только если копия заметно лучше и сама почти без нарушений', () => {
    const ours = q({ paintsBound: 1, spacingsBound: 3 });
    expect(gains(q(), ours).map((g) => g.criterion)).toEqual(['colors']);
    expect(gains(q({ paintsBound: 3 }), ours)).toEqual([]);
  });

  it('по группе — пункт, лучший хотя бы в 2/3 копий', () => {
    const ours = q({ paintsBound: 0 });
    expect(groupGains([q(), q(), q({ paintsBound: 0 })], ours).map((g) => g.criterion)).toEqual(['colors']);
    expect(groupGains([q(), q({ paintsBound: 0 }), q({ paintsBound: 0 })], ours)).toEqual([]);
    expect(gainText(groupGains([q()], ours)[0])).toBe('Цвета на переменных: в макете 100 %, у нашего 0 %');
  });
});
