import { describe, expect, it } from 'vitest';
import type { KeyHit } from '../src/core/library-index';
import { buildReport, classifyInstance, type DetachedFinding, type InstanceFinding } from '../src/core/scan-report';

const hit = (name: string): KeyHit => ({ libraryId: 'driver-components', product: 'driver', kind: 'components', name });
const lookup = new Map<string, KeyHit>([
  ['set-btn', hit('button')],
  ['divider', hit('divider')],
]);

const screenA = { id: '1:1', name: 'Order' };
const screenB = { id: '1:2', name: 'Chat' };

const inst = (nodeId: string, screen: typeof screenA, componentKey: string, extra: Partial<InstanceFinding> = {}): InstanceFinding => ({
  nodeId,
  screen,
  componentKey,
  componentName: componentKey,
  remote: true,
  width: 100,
  height: 40,
  ...extra,
});

describe('classifyInstance', () => {
  it('наш — по ключу набора или компонента', () => {
    expect(classifyInstance({ componentKey: 'btn-m', setKey: 'set-btn', remote: true }, lookup)).toBe('ours');
    expect(classifyInstance({ componentKey: 'divider', remote: true }, lookup)).toBe('ours');
  });
  it('не из индекса: из библиотеки — чужой, из файла — локальный', () => {
    expect(classifyInstance({ componentKey: 'old', remote: true }, lookup)).toBe('foreign');
    expect(classifyInstance({ componentKey: 'old', remote: false }, lookup)).toBe('local');
  });
});

describe('buildReport', () => {
  const instances = [
    inst('2:1', screenA, 'old-btn', { setKey: 'old-set', setName: 'Button' }),
    inst('2:2', screenB, 'old-btn-2', { setKey: 'old-set', setName: 'Button' }),
    inst('2:3', screenA, 'old-btn', { setKey: 'old-set', setName: 'Button' }),
    inst('2:4', screenA, 'icon-star'),
    inst('2:5', screenA, 'btn-m', { setKey: 'set-btn', setName: 'button' }),
    inst('2:6', screenB, 'mine', { remote: false }),
  ];
  const detached: DetachedFinding[] = [
    { nodeId: '3:1', name: 'divider copy', screen: screenA, width: 360, height: 1, detached: { type: 'library', componentKey: 'divider' } },
    { nodeId: '3:2', name: 'card', screen: screenB, width: 328, height: 120, detached: { type: 'local', componentId: '9:9' } },
  ];
  const report = buildReport(instances, detached, lookup);

  it('считает итоги', () => {
    expect(report.totals).toEqual({ ours: 1, foreign: 4, local: 1, detachedOurs: 1, detachedOther: 1 });
  });

  it('группирует варианты одного набора и считает экраны', () => {
    const button = report.groups.find((g) => g.id === 'old-set')!;
    expect(button).toMatchObject({ origin: 'foreign', name: 'Button', count: 3, screens: 2, exampleNodeId: '2:1', exampleScreen: 'Order', nodeIds: ['2:1', '2:2', '2:3'] });
  });

  it('сначала чужие (по убыванию), потом локальные, наши — в конце', () => {
    expect(report.groups.map((g) => `${g.origin}:${g.detached ? 'd' : 'i'}:${g.id}`)).toEqual([
      'foreign:i:old-set',
      'foreign:i:icon-star',
      'local:i:mine',
      'local:d:d:9:9',
      'ours:i:set-btn',
      'ours:d:d:divider',
    ]);
  });

  it('отвязанный от нашего — имя из индекса', () => {
    expect(report.groups.find((g) => g.detached && g.id === 'd:divider')).toMatchObject({ origin: 'ours', name: 'divider', libraryId: 'driver-components', detachedKey: 'divider' });
  });
});
