import { describe, expect, it } from 'vitest';
import { innerReactionLayers, retargetReactions, writableReactions } from '../src/core/reactions';

const navigate = (destinationId: string | null) => ({
  trigger: { type: 'ON_CLICK' },
  actions: [{ type: 'NODE', destinationId, navigation: 'NAVIGATE', transition: null }],
});

describe('retargetReactions', () => {
  it('переход на заменённый фрейм ведёт на экземпляр, остальное не меняется', () => {
    const before = [navigate('1:2'), navigate('9:9'), { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }];
    const next = retargetReactions(before, new Map([['1:2', '5:5']]));
    expect(next).toEqual([navigate('5:5'), navigate('9:9'), before[2]]);
    expect(before[0]).toEqual(navigate('1:2'));
  });

  it('цели внутри CONDITIONAL и в устаревшем поле action тоже', () => {
    const conditional = {
      trigger: { type: 'ON_CLICK' },
      actions: [{ type: 'CONDITIONAL', conditionalBlocks: [{ condition: { type: 'EXPRESSION' }, actions: navigate('1:3').actions }] }],
    };
    const legacy = { trigger: { type: 'ON_HOVER' }, action: navigate('1:3').actions[0] };
    const next = retargetReactions([conditional, legacy], new Map([['1:3', '5:5']]));
    expect(JSON.stringify(next)).not.toContain('1:3');
    expect(JSON.stringify(next).match(/5:5/g)).toHaveLength(2);
  });

  it('ничего не ведёт на прежние цели — null', () => {
    expect(retargetReactions([navigate('9:9'), navigate(null)], new Map([['1:2', '5:5']]))).toBeNull();
    expect(retargetReactions([], new Map([['1:2', '5:5']]))).toBeNull();
  });
});

describe('writableReactions', () => {
  it('при наличии actions устаревшее action не пишется', () => {
    const both = { trigger: null, action: { type: 'BACK' }, actions: [{ type: 'BACK' }] };
    const onlyLegacy = { trigger: null, action: { type: 'BACK' } };
    expect(writableReactions([both, onlyLegacy])).toEqual([{ trigger: null, actions: [{ type: 'BACK' }] }, onlyLegacy]);
  });
});

describe('innerReactionLayers', () => {
  it('считает слои с переходами внутри, без корня', () => {
    const root = {
      reactions: [navigate('1:1')],
      children: [{ reactions: [navigate('1:1')] }, { reactions: [], children: [{ reactions: [navigate('1:1')] }] }, {}],
    };
    expect(innerReactionLayers(root)).toBe(2);
  });
});
