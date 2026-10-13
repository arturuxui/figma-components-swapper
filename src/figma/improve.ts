// Карточки доработок наших компонентов (этап 5): расхождения, по которым пользователь при замене выбрал «нужен
// вариант», — на странице «Components Swapper · Предложения». На карточке: что изменено, где, почему, ссылка на пример
// и рядом два экземпляра — как в нашем компоненте и как в макете. Библиотека не меняется.

import type { OverrideGroup } from '../core/overrides';
import { improvementText } from '../core/proposal';
import { BOLD, page, REGULAR, stack, text } from './propose';

export interface Improvement {
  group: OverrideGroup;
  /** Наш компонент, на который заменили (имя для карточки). */
  ours: string;
}

export interface ImproveResult {
  pageId: string;
  containerId: string;
  cards: number;
}

/** Первое место группы, которое после замены — экземпляр (место могли удалить или пропустить). */
async function example(group: OverrideGroup): Promise<InstanceNode | null> {
  for (const id of [group.exampleNodeId, ...group.nodeIds]) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && node.type === 'INSTANCE' && !node.removed) return node;
  }
  return null;
}

/**
 * Фон места в макете — заливка ближайшего предка: без неё экземпляр без своего фона (белый текст) на белой
 * карточке не виден. Нет — светло-серый.
 */
function backdropOf(node: SceneNode): Paint[] {
  for (let p = node.parent; p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = p.parent) {
    const fills = 'fills' in p && Array.isArray(p.fills) ? (p.fills as Paint[]).filter((f) => f.visible !== false && f.type === 'SOLID') : [];
    if (fills.length) return fills;
  }
  return [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 } }];
}

/** Экземпляр с подписью на фоне места в макете — «как в нашем компоненте» / «как в макете». */
function figure(node: SceneNode, caption: string, backdrop: Paint[]): FrameNode {
  const box = stack('VERTICAL', caption, 6);
  box.appendChild(text(caption, REGULAR, 11, 0.45));
  const back = stack('VERTICAL', 'Фон из макета', 0);
  back.paddingTop = back.paddingBottom = back.paddingLeft = back.paddingRight = 12;
  back.cornerRadius = 8;
  back.fills = backdrop;
  back.appendChild(node);
  box.appendChild(back);
  return box;
}

async function card(item: Improvement): Promise<FrameNode | null> {
  const inst = await example(item.group);
  const main = inst ? await inst.getMainComponentAsync().catch(() => null) : null;
  if (!inst || !main) return null;
  const t = improvementText(item.group, item.ours);
  const box = stack('VERTICAL', t.title, 8);
  box.paddingTop = box.paddingBottom = box.paddingLeft = box.paddingRight = 16;
  box.cornerRadius = 12;
  box.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  box.strokes = [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }];

  box.appendChild(text(t.title, BOLD, 16));
  box.appendChild(text(t.meta, REGULAR, 12, 0.4));
  for (const c of t.changes) box.appendChild(text(c, REGULAR, 12, 0.25));
  const why = text(t.why, REGULAR, 12, 0.25);
  box.appendChild(why);
  const link = text(`Показать пример — экран «${item.group.exampleScreen}»`, REGULAR, 12);
  link.fills = [{ type: 'SOLID', color: { r: 0.05, g: 0.4, b: 0.9 } }];
  link.setRangeHyperlink(0, link.characters.length, { type: 'NODE', value: inst.id });
  box.appendChild(link);

  const row = stack('HORIZONTAL', 'Сравнение', 24);
  const backdrop = backdropOf(inst);
  row.appendChild(figure(main.createInstance(), 'Как в нашем компоненте', backdrop));
  const copy = inst.clone();
  copy.x = copy.y = 0;
  row.appendChild(figure(copy, 'Как в макете — нужен вариант', backdrop));
  box.appendChild(row);

  why.resize(Math.max(320, row.width), why.height);
  why.textAutoResize = 'HEIGHT';
  return box;
}

/** Карточки доработок — новым блоком справа от прежних на странице предложений. */
export async function proposeImprovements(items: readonly Improvement[], progress: (text: string) => void): Promise<ImproveResult | null> {
  if (!items.length) return null;
  await Promise.all([figma.loadFontAsync(REGULAR), figma.loadFontAsync(BOLD)]);
  const target = await page();
  await target.loadAsync();

  const container = stack('HORIZONTAL', `Доработки · ${new Date().toLocaleString('ru-RU')}`, 24);
  container.counterAxisAlignItems = 'MIN';
  target.appendChild(container);
  const right = target.children.filter((n) => n !== container).reduce((x, n) => Math.max(x, n.x + n.width), 0);
  container.x = right ? right + 200 : 0;
  container.y = 0;

  let cards = 0;
  for (let i = 0; i < items.length; i++) {
    progress(`Доработка ${i + 1} из ${items.length}: ${items[i].ours}`);
    const box = await card(items[i]);
    if (!box) continue;
    container.appendChild(box);
    cards++;
  }
  if (!cards) {
    container.remove();
    return null;
  }
  return { pageId: target.id, containerId: container.id, cards };
}
