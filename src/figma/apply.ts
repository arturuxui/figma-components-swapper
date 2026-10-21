// Применение замены (этап 1в–1г): выбранные пары → `swapComponent` по всем местам группы, потом второй проход
// по вложенным экземплярам (спайк 2026-10-09: `swapComponent` оставляет старые вложенные иконки).
// Каждая замена пишется в журнал: «Отменить» возвращает старый главный компонент — с теми же вариантом,
// текстами и вложенными подменами. Фреймы (этап 2) заменяются экземплярами (replace-frame.ts): при отмене экземпляр
// удаляется, а скрытый фрейм снова виден.
// Расхождения экземпляров со своим компонентом (этап 5) — по выбору пользователя: «ошибка макета» — как в нашем
// компоненте, «перенести» и «нужен вариант» — повторить на нашем экземпляре. Отмена возвращает и их.

import type { KeyHit } from '../core/library-index';
import { matchByName, type Candidate } from '../core/match';
import type { OverrideChoice } from '../core/overrides';
import { applyOverride, captureOverrides, restoreOverrides, type CapturedOverride } from './overrides';
import { iconColor, paintIcon } from './icon-geometry';
import { replaceFrame, type FrameContext } from './replace-frame';
import { chooseComponent, importTarget, swapInstance } from './swap';

export interface ApplyGroup {
  name: string;
  nodeIds: string[];
  target: Pick<Candidate, 'key' | 'isSet'>;
  /** Иконка: цвет одноцветной иконки макета переносится на нашу (решение PD — цвет из макета). */
  recolor?: boolean;
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
  /** Расхождения с компонентом (этап 5): сколько перенесено, сколько приведено к нашему, что не вышло. */
  overrides: { kept: number; reset: number; variants: number; undecided: number; failed: ApplyIssue[] };
  /** Карточки «нужен вариант» на странице предложений (заполняет main.ts после замены). */
  improvements?: { pageName: string; cards: number };
  errors: ApplyIssue[];
}

type JournalEntry =
  | { kind: 'swap'; node: InstanceNode; previous: ComponentNode; captured?: CapturedOverride[] }
  /** Наш экземпляр, которому вернули значения компонента («ошибка макета»): при отмене — прежние значения. */
  | { kind: 'props'; node: InstanceNode; captured: CapturedOverride[] }
  | { kind: 'frame'; frame: FrameNode; instance: InstanceNode; wasVisible: boolean };

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
  /** Экземпляры с расхождениями → выбор пользователя (null — не решено: как сделает замена, но с отменой). */
  overrides?: ReadonlyMap<string, OverrideChoice | null>;
}

export async function applySwaps(groups: readonly ApplyGroup[], ctx: ApplyContext): Promise<ApplyResult> {
  const result: ApplyResult = {
    replaced: 0,
    frames: 0,
    nested: 0,
    skipped: 0,
    lostTexts: [],
    axesMissing: 0,
    leftovers: [],
    overrides: { kept: 0, reset: 0, variants: 0, undecided: 0, failed: [] },
    errors: [],
  };
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

  /** Расхождения после замены — по выбору пользователя. */
  const settleOverrides = async (node: InstanceNode, name: string, captured: CapturedOverride[], choice: OverrideChoice | null) => {
    if (!choice) {
      result.overrides.undecided++;
      return;
    }
    const failed: string[] = [];
    for (const c of captured) {
      try {
        if (!(await applyOverride(node, c, choice === 'error' ? 'reset' : 'keep'))) failed.push(`${c.diff.layer}: ${c.diff.to}`);
      } catch {
        failed.push(`${c.diff.layer}: ${c.diff.to}`);
      }
    }
    if (failed.length) result.overrides.failed.push({ nodeId: node.id, name, message: failed.join(', ') });
    if (choice === 'error') result.overrides.reset++;
    else if (choice === 'variant') result.overrides.variants++;
    else result.overrides.kept++;
  };

  const swapOne = async (node: InstanceNode, name: string, target: Pick<Candidate, 'key' | 'isSet'>, recolor = false) => {
    const previous = await readMain(node);
    if (!previous) return false;
    const color = recolor ? iconColor(node).paint : null;
    const choice = ctx.overrides?.get(node.id);
    // Запоминаем только то, что после замены будет выглядеть иначе, чем наш компонент.
    const against = choice === undefined ? undefined : (await chooseComponent(await importTarget(target), node)).component;
    const captured = choice === undefined ? undefined : await captureOverrides(node, against);
    const outcome = await swapInstance(node, target);
    // Многоцветная наша иконка (логотип) остаётся в своих цветах.
    if (color && !iconColor(node).multicolor) paintIcon(node, color);
    journal.push({ kind: 'swap', node, previous, captured });
    if (captured?.length) await settleOverrides(node, name, captured, choice ?? null);
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
        if (await swapOne(node, group.name, group.target, group.recolor)) {
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

/**
 * Решения по расхождениям наших экземпляров (этап 5, без замены): «ошибка макета» — вернуть слоям значения
 * компонента, «перенести» и «нужен вариант» — оставить как есть (карточки «нужен вариант» делает main.ts).
 */
export async function settleOurs(items: readonly { name: string; nodeIds: string[]; choice: OverrideChoice }[], progress: (text: string) => void): Promise<ApplyResult> {
  const result: ApplyResult = {
    replaced: 0,
    frames: 0,
    nested: 0,
    skipped: 0,
    lostTexts: [],
    axesMissing: 0,
    leftovers: [],
    overrides: { kept: 0, reset: 0, variants: 0, undecided: 0, failed: [] },
    errors: [],
  };
  finalizeFrames();
  journal = [];
  commitUndo();
  const total = items.reduce((n, i) => n + i.nodeIds.length, 0);
  let done = 0;
  for (const item of items) {
    for (const id of item.nodeIds) {
      if (++done % 20 === 0) progress(`Расхождения: ${done} из ${total}`);
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.type !== 'INSTANCE' || node.removed) {
        result.skipped++;
        continue;
      }
      if (item.choice === 'keep') result.overrides.kept++;
      else if (item.choice === 'variant') result.overrides.variants++;
      if (item.choice !== 'error') continue;
      try {
        const captured = await captureOverrides(node);
        const failed: string[] = [];
        for (const c of captured) if (!(await applyOverride(node, c, 'reset'))) failed.push(`${c.diff.layer}: ${c.diff.to}`);
        journal.push({ kind: 'props', node, captured });
        if (failed.length) result.overrides.failed.push({ nodeId: id, name: item.name, message: failed.join(', ') });
        result.overrides.reset++;
      } catch (e) {
        result.errors.push({ nodeId: id, name: item.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  commitUndo();
  return result;
}

/** Откат последнего применения: в обратном порядке, вложенные — раньше своих корней. */
export async function undoSwaps(progress: (text: string) => void): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i];
    if ((journal.length - i) % 20 === 0) progress(`Возвращено ${journal.length - i} из ${journal.length}`);
    try {
      if (entry.kind === 'props') {
        if (entry.node.removed) throw new Error('removed');
        await restoreOverrides(entry.node, entry.captured);
      } else if (entry.kind === 'swap') {
        if (entry.node.removed) throw new Error('removed');
        entry.node.swapComponent(entry.previous);
        if (entry.captured?.length) await restoreOverrides(entry.node, entry.captured);
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
