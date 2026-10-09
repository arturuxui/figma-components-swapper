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
}

/** Фрейм, отвязанный от компонента (`detachedInfo`). */
export interface DetachedFinding {
  nodeId: string;
  name: string;
  screen: ScreenRef;
  detached: { type: 'library'; componentKey: string } | { type: 'local'; componentId: string };
}

export interface ReportGroup {
  /** Ключ набора, иначе ключ компонента (у отвязанных от локального — id компонента). */
  id: string;
  origin: Origin;
  /** Находка — экземпляр или отвязанный фрейм. */
  detached: boolean;
  name: string;
  count: number;
  /** На скольких экранах встречается. */
  screens: number;
  /** Первое вхождение — кнопка «Показать». */
  exampleNodeId: string;
  exampleScreen: string;
  /** Для наших — из какой библиотеки. */
  libraryId?: string;
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

  const add = (key: string, base: Omit<ReportGroup, 'count' | 'screens' | 'exampleNodeId' | 'exampleScreen'>, nodeId: string, screen: ScreenRef) => {
    let g = groups.get(key);
    if (!g) {
      g = { ...base, count: 0, screens: 0, exampleNodeId: nodeId, exampleScreen: screen.name, screenIds: new Set() };
      groups.set(key, g);
    }
    g.count++;
    g.screenIds.add(screen.id);
  };

  for (const f of instances) {
    const origin = classifyInstance(f, lookup);
    totals[origin]++;
    const id = f.setKey ?? f.componentKey;
    const hit = lookup.get(id) ?? lookup.get(f.componentKey);
    add(`i:${id}`, { id, origin, detached: false, name: f.setName ?? f.componentName, libraryId: hit?.libraryId }, f.nodeId, f.screen);
  }

  for (const f of detached) {
    const origin = detachedOrigin(f, lookup);
    if (origin === 'ours') totals.detachedOurs++;
    else totals.detachedOther++;
    const id = f.detached.type === 'library' ? f.detached.componentKey : f.detached.componentId;
    const hit = f.detached.type === 'library' ? lookup.get(id) : undefined;
    add(`d:${id}`, { id, origin, detached: true, name: hit?.name ?? f.name, libraryId: hit?.libraryId }, f.nodeId, f.screen);
  }

  const list = [...groups.values()].map(({ screenIds, ...g }) => ({ ...g, screens: screenIds.size }));
  list.sort((a, b) => ORDER[a.origin] - ORDER[b.origin] || Number(a.detached) - Number(b.detached) || b.count - a.count || a.name.localeCompare(b.name));
  return { totals, groups: list };
}
