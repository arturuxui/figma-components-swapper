// Отчёт скана макета (этап 1а): что в макете из наших библиотек, что чужое, что отвязано.
// Без Figma API: скан (src/figma/scan.ts) собирает находки, здесь — классификация и группировка.

import type { KeyHit } from './library-index';

/**
 * - `ours` — компонент из индекса библиотек WB AID;
 * - `foreign` — компонент другой библиотеки;
 * - `local` — локальный компонент этого файла (не из библиотеки).
 */
export type Origin = 'ours' | 'foreign' | 'local';

export interface ScreenRef {
  id: string;
  name: string;
}

export interface InstanceFinding {
  nodeId: string;
  screen: ScreenRef;
  componentKey: string;
  componentName: string;
  setKey?: string;
  setName?: string;
  /** Компонент из библиотеки, а не из этого файла. */
  remote: boolean;
  width: number;
  height: number;
}

/** Фрейм, отвязанный от компонента (`detachedInfo`). */
export interface DetachedFinding {
  nodeId: string;
  name: string;
  screen: ScreenRef;
  width: number;
  height: number;
  detached: { type: 'library'; componentKey: string } | { type: 'local'; componentId: string };
}

export interface ReportGroup {
  /** Ключ набора, иначе ключ компонента; у отвязанных — `d:` + ключ (или id локального) компонента. */
  id: string;
  origin: Origin;
  /** Находка — экземпляр или отвязанный фрейм. */
  detached: boolean;
  /** Ручной фрейм, похожий на наш компонент (этап 2б). */
  manual?: boolean;
  name: string;
  count: number;
  /** На скольких экранах встречается. */
  screens: number;
  /** Первое вхождение — кнопка «Показать». */
  exampleNodeId: string;
  exampleScreen: string;
  /** Размер первого вхождения — для подбора среди одноимённых по размеру (правило 27). */
  width: number;
  height: number;
  /** Все вхождения — для замены. */
  nodeIds: string[];
  /** Для наших — из какой библиотеки. */
  libraryId?: string;
  /** Отвязанный от библиотечного компонента: его ключ (у отвязанных от нашего — это и есть пара). */
  detachedKey?: string;
}

export interface ScanReport {
  totals: {
    ours: number;
    foreign: number;
    local: number;
    /** Отвязаны от нашего компонента — точные кандидаты этапа 2. */
    detachedOurs: number;
    detachedOther: number;
  };
  groups: ReportGroup[];
}

export function classifyInstance(f: Pick<InstanceFinding, 'componentKey' | 'setKey' | 'remote'>, lookup: ReadonlyMap<string, KeyHit>): Origin {
  if ((f.setKey && lookup.has(f.setKey)) || lookup.has(f.componentKey)) return 'ours';
  return f.remote ? 'foreign' : 'local';
}

function detachedOrigin(f: DetachedFinding, lookup: ReadonlyMap<string, KeyHit>): Origin {
  if (f.detached.type === 'local') return 'local';
  return lookup.has(f.detached.componentKey) ? 'ours' : 'foreign';
}

/** Порядок в отчёте: сначала то, что надо менять. */
const ORDER: Record<Origin, number> = { foreign: 0, local: 1, ours: 2 };

export function buildReport(
  instances: readonly InstanceFinding[],
  detached: readonly DetachedFinding[],
  lookup: ReadonlyMap<string, KeyHit>,
): ScanReport {
  const totals = { ours: 0, foreign: 0, local: 0, detachedOurs: 0, detachedOther: 0 };
  const groups = new Map<string, ReportGroup & { screenIds: Set<string> }>();

  type Found = { nodeId: string; screen: ScreenRef; width: number; height: number };
  const add = (key: string, base: Omit<ReportGroup, 'count' | 'screens' | 'exampleNodeId' | 'exampleScreen' | 'width' | 'height' | 'nodeIds'>, f: Found) => {
    let g = groups.get(key);
    if (!g) {
      g = { ...base, count: 0, screens: 0, exampleNodeId: f.nodeId, exampleScreen: f.screen.name, width: f.width, height: f.height, nodeIds: [], screenIds: new Set() };
      groups.set(key, g);
    }
    g.count++;
    g.nodeIds.push(f.nodeId);
    g.screenIds.add(f.screen.id);
  };

  for (const f of instances) {
    const origin = classifyInstance(f, lookup);
    totals[origin]++;
    const id = f.setKey ?? f.componentKey;
    const hit = lookup.get(id) ?? lookup.get(f.componentKey);
    add(`i:${id}`, { id, origin, detached: false, name: f.setName ?? f.componentName, libraryId: hit?.libraryId }, f);
  }

  for (const f of detached) {
    const origin = detachedOrigin(f, lookup);
    if (origin === 'ours') totals.detachedOurs++;
    else totals.detachedOther++;
    const id = f.detached.type === 'library' ? f.detached.componentKey : f.detached.componentId;
    const hit = f.detached.type === 'library' ? lookup.get(id) : undefined;
    const detachedKey = f.detached.type === 'library' ? f.detached.componentKey : undefined;
    add(`d:${id}`, { id: `d:${id}`, origin, detached: true, name: hit?.name ?? f.name, libraryId: hit?.libraryId, detachedKey }, f);
  }

  const list = [...groups.values()].map(({ screenIds, ...g }) => ({ ...g, screens: screenIds.size }));
  list.sort((a, b) => ORDER[a.origin] - ORDER[b.origin] || Number(a.detached) - Number(b.detached) || b.count - a.count || a.name.localeCompare(b.name));
  return { totals, groups: list };
}
