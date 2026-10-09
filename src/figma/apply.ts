// Применение замены (этап 1в–1г): выбранные пары → `swapComponent` по всем местам группы, потом второй проход
// по вложенным экземплярам (спайк 2026-10-09: `swapComponent` оставляет старые вложенные иконки).
// Каждая замена пишется в журнал: «Отменить» возвращает старый главный компонент — с теми же вариантом,
// текстами и вложенными подменами. Фреймы (этап 2) заменяются экземплярами (replace-frame.ts): при отмене экземпляр
// удаляется, а скрытый фрейм снова виден.

import type { KeyHit } from '../core/library-index';
import { matchByName, type Candidate } from '../core/match';
import { replaceFrame, type FrameContext } from './replace-frame';
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
  /** Из них фреймов, заменённых экземплярами (этап 2). */
  frames: number;
  /** Вложенные старые экземпляры внутри заменённых, заменённые вторым проходом. */
  nested: number;
  /** Место исчезло или уже не тот компонент (макет меняли после скана). */
  skipped: number;
  /** Пропали видимые тексты — проверить глазами. */
  lostTexts: ApplyIssue[];
  /** Осей старого варианта нет у нашего набора — по ним вариант по умолчанию. */
  axesMissing: number;
  /** Фреймы: тексты и иконки компонента, которые остались как в библиотеке, — проверить глазами. */
  leftovers: ApplyIssue[];
  errors: ApplyIssue[];
}

type JournalEntry = { kind: 'swap'; node: InstanceNode; previous: ComponentNode } | { kind: 'frame'; frame: FrameNode; instance: InstanceNode; wasVisible: boolean };

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

/**
 * Окончательно удалить скрытые фреймы, заменённые экземплярами, — после этого отменить их замену нельзя.
 * Вызывается перед новым сканом и применением и при закрытии плагина.
 */
export function finalizeFrames() {
  for (const entry of journal) {
    if (entry.kind !== 'frame' || entry.frame.removed || entry.instance.removed || entry.frame.visible) continue;
    entry.frame.remove();
  }
  journal = journal.filter((e) => e.kind !== 'frame');
}

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

export interface ApplyContext extends FrameContext {
  lookup: ReadonlyMap<string, KeyHit>;
  progress: (text: string) => void;
}

export async function applySwaps(groups: readonly ApplyGroup[], ctx: ApplyContext): Promise<ApplyResult> {
  const result: ApplyResult = { replaced: 0, frames: 0, nested: 0, skipped: 0, lostTexts: [], axesMissing: 0, leftovers: [], errors: [] };
  finalizeFrames();
  journal = [];
  // Отдельный шаг в истории Figma: Ctrl+Z после плагина не захватит то, что было до него.
  commitUndo();

  const total = groups.reduce((n, g) => n + g.nodeIds.length, 0);
  const swapped: InstanceNode[] = [];
  /** Фреймы, заменённые в этом применении: вложенный в такой фрейм уже скрыт вместе с ним. */
  const replacedFrames = new Set<string>();
  const insideReplaced = (node: BaseNode) => {
    for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (replacedFrames.has(p.id)) return true;
    return false;
  };
  let done = 0;

  const swapOne = async (node: InstanceNode, name: string, target: Pick<Candidate, 'key' | 'isSet'>) => {
    const previous = await readMain(node);
    if (!previous) return false;
    const outcome = await swapInstance(node, target);
    journal.push({ kind: 'swap', node, previous });
    if (outcome.lost.length) result.lostTexts.push({ nodeId: node.id, name, message: outcome.lost.map((t) => `«${t}»`).join(', ') });
    if (outcome.pick?.unmatched.length) result.axesMissing++;
    return true;
  };

  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (++done % 10 === 0) ctx.progress(`Заменено ${done} из ${total}`);
      const node = await figma.getNodeByIdAsync(nodeId);
      if (node && node.type === 'FRAME') {
        if (!node.visible || node.removed || insideReplaced(node)) {
          result.skipped++;
          continue;
        }
        try {
          const wasVisible = node.visible;
          const out = await replaceFrame(node, group.target, ctx);
          journal.push({ kind: 'frame', frame: node, instance: out.instance, wasVisible });
          replacedFrames.add(node.id);
          result.replaced++;
          result.frames++;
          if (out.lost.length) result.lostTexts.push({ nodeId: out.instance.id, name: group.name, message: out.lost.map((t) => `«${t}»`).join(', ') });
          const left = [...out.placeholders.map((t) => `текст «${t}»`), ...out.iconsMissing.map((i) => `иконка ${i} (нет у нас)`)];
          if (left.length) result.leftovers.push({ nodeId: out.instance.id, name: group.name, message: left.join(', ') });
        } catch (e) {
          result.errors.push({ nodeId, name: group.name, message: e instanceof Error ? e.message : String(e) });
        }
        continue;
      }
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
    const entry = journal[i];
    if ((journal.length - i) % 20 === 0) progress(`Возвращено ${journal.length - i} из ${journal.length}`);
    try {
      if (entry.kind === 'swap') {
        if (entry.node.removed) throw new Error('removed');
        entry.node.swapComponent(entry.previous);
      } else {
        if (entry.frame.removed) throw new Error('removed');
        if (!entry.instance.removed) entry.instance.remove();
        entry.frame.visible = entry.wasVisible;
        try {
          entry.frame.setPluginData('cs-replaced', '');
        } catch {
          // метки могло не быть
        }
      }
      restored++;
    } catch {
      failed++;
    }
  }
  journal = [];
  commitUndo();
  return { restored, failed };
}
