// Применение замены (этап 1в–1г): выбранные пары → `swapComponent` по всем местам группы, потом второй проход
// по вложенным экземплярам (спайк 2026-10-09: `swapComponent` оставляет старые вложенные иконки).
// Каждая замена пишется в журнал: «Отменить» возвращает старый главный компонент — с теми же вариантом,
// текстами и вложенными подменами.

import type { KeyHit } from '../core/library-index';
import { matchByName, type Candidate } from '../core/match';
import { swapInstance } from './swap';

export interface ApplyGroup {
  name: string;
  nodeIds: string[];
  target: Pick<Candidate, 'key' | 'isSet'>;
}

export interface ApplyIssue {
  nodeId: string;
  name: string;
  message: string;
}

export interface ApplyResult {
  replaced: number;
  /** Вложенные старые экземпляры внутри заменённых, заменённые вторым проходом. */
  nested: number;
  /** Место исчезло или уже не тот компонент (макет меняли после скана). */
  skipped: number;
  /** Пропали видимые тексты — проверить глазами. */
  lostTexts: ApplyIssue[];
  /** Осей старого варианта нет у нашего набора — по ним вариант по умолчанию. */
  axesMissing: number;
  errors: ApplyIssue[];
}

interface JournalEntry {
  node: InstanceNode;
  previous: ComponentNode;
}

/** Отдельный шаг в истории Figma. В некоторых средах (сервер Figma MCP) API нет — тогда без отдельного шага. */
function commitUndo() {
  try {
    figma.commitUndo();
  } catch {
    // нет API — не страшно: «Отменить» в плагине работает по своему журналу
  }
}

/** Журнал последнего применения — для «Отменить». Живёт до следующего применения или закрытия плагина. */
let journal: JournalEntry[] = [];

export const canUndo = () => journal.length > 0;

const mainKey = (main: ComponentNode) => (main.parent?.type === 'COMPONENT_SET' ? main.parent.key : main.key);
const mainName = (main: ComponentNode) => (main.parent?.type === 'COMPONENT_SET' ? main.parent.name : main.name);
const isOurs = (main: ComponentNode, lookup: ReadonlyMap<string, KeyHit>) => lookup.has(mainKey(main)) || lookup.has(main.key);

async function readMain(node: InstanceNode): Promise<ComponentNode | null> {
  try {
    return await node.getMainComponentAsync();
  } catch {
    return null;
  }
}

export interface ApplyContext {
  lookup: ReadonlyMap<string, KeyHit>;
  byName: ReadonlyMap<string, Candidate[]>;
  product?: string;
  progress: (text: string) => void;
}

export async function applySwaps(groups: readonly ApplyGroup[], ctx: ApplyContext): Promise<ApplyResult> {
  const result: ApplyResult = { replaced: 0, nested: 0, skipped: 0, lostTexts: [], axesMissing: 0, errors: [] };
  journal = [];
  // Отдельный шаг в истории Figma: Ctrl+Z после плагина не захватит то, что было до него.
  commitUndo();

  const total = groups.reduce((n, g) => n + g.nodeIds.length, 0);
  const swapped: InstanceNode[] = [];
  let done = 0;

  const swapOne = async (node: InstanceNode, name: string, target: Pick<Candidate, 'key' | 'isSet'>) => {
    const previous = await readMain(node);
    if (!previous) return false;
    const outcome = await swapInstance(node, target);
    journal.push({ node, previous });
    if (outcome.lost.length) result.lostTexts.push({ nodeId: node.id, name, message: outcome.lost.map((t) => `«${t}»`).join(', ') });
    if (outcome.pick?.unmatched.length) result.axesMissing++;
    return true;
  };

  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (++done % 10 === 0) ctx.progress(`Заменено ${done} из ${total}`);
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || node.type !== 'INSTANCE') {
        result.skipped++;
        continue;
      }
      const main = await readMain(node);
      // Уже наш (заменили руками после скана) или главный компонент не читается — не трогаем.
      if (!main || isOurs(main, ctx.lookup)) {
        result.skipped++;
        continue;
      }
      try {
        if (await swapOne(node, group.name, group.target)) {
          result.replaced++;
          swapped.push(node);
        } else result.skipped++;
      } catch (e) {
        result.errors.push({ nodeId, name: group.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Второй проход: старые вложенные экземпляры внутри заменённых → наши по имени (только уверенные пары).
  // Замена вложенного меняет его потомков, поэтому проходим несколько раз, пока есть что менять.
  ctx.progress('Вложенные иконки и компоненты…');
  for (let round = 0; round < 3; round++) {
    let changed = 0;
    for (const root of swapped) {
      if (root.removed) continue;
      for (const nested of root.findAllWithCriteria({ types: ['INSTANCE'] })) {
        if (nested.removed) continue;
        const main = await readMain(nested);
        if (!main || isOurs(main, ctx.lookup)) continue;
        const match = matchByName(mainName(main), nested, ctx.byName, ctx.product);
        if (match.status !== 'exact' || !match.target) continue;
        try {
          if (await swapOne(nested, mainName(main), match.target)) {
            result.nested++;
            changed++;
          }
        } catch (e) {
          result.errors.push({ nodeId: nested.id, name: mainName(main), message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    if (!changed) break;
  }

  commitUndo();
  return result;
}

/** Откат последнего применения: в обратном порядке, вложенные — раньше своих корней. */
export function undoSwaps(progress: (text: string) => void): { restored: number; failed: number } {
  let restored = 0;
  let failed = 0;
  for (let i = journal.length - 1; i >= 0; i--) {
    const { node, previous } = journal[i];
    if ((journal.length - i) % 20 === 0) progress(`Возвращено ${journal.length - i} из ${journal.length}`);
    try {
      if (node.removed) throw new Error('removed');
      node.swapComponent(previous);
      restored++;
    } catch {
      failed++;
    }
  }
  journal = [];
  commitUndo();
  return { restored, failed };
}
