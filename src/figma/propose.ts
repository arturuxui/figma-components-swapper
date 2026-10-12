// Черновики новых компонентов (этап 4): страница «Components Swapper · Предложения» в файле макета, на ней карточки —
// название, где встречается, свойства, обоснование, ссылка на пример и черновик компонента (копия примера,
// превращённая в компонент; меняющиеся тексты и иконки — свойства). Сам макет не меняется: копируется пример.

import { PROPOSALS_PAGE, proposalText } from '../core/proposal';
import type { RepeatGroup } from '../core/repeats';
import { signature } from '../core/structure';
import { snapshot } from './structure';

const REGULAR: FontName = { family: 'Inter', style: 'Regular' };
const BOLD: FontName = { family: 'Inter', style: 'Semi Bold' };

export interface ProposeResult {
  pageId: string;
  containerId: string;
  drafts: number;
  /** Пример не нашёлся (удалён после скана). */
  missing: string[];
}

/** Фрейм с auto layout, растущий по содержимому. */
function stack(direction: 'HORIZONTAL' | 'VERTICAL', name: string, gap: number): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = direction;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.itemSpacing = gap;
  return f;
}

async function page(): Promise<PageNode> {
  const existing = figma.root.children.find((p) => p.name === PROPOSALS_PAGE);
  if (existing) return existing;
  const created = figma.createPage();
  created.name = PROPOSALS_PAGE;
  return created;
}

function text(characters: string, font: FontName, size: number, color = 0.1): TextNode {
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.characters = characters;
  t.fills = [{ type: 'SOLID', color: { r: color, g: color, b: color } }];
  return t;
}

/** Слой лежит внутри вложенного экземпляра — свойством черновика его не сделать (меняется свойствами вложенного). */
function insideInstance(node: BaseNode, root: ComponentNode): boolean {
  for (let p = node.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true;
  return false;
}

/**
 * Меняющиеся тексты и иконки черновика — свойства компонента (текст и замена экземпляра). Слои внутри вложенных
 * экземпляров пропускаются: Figma не даёт привязать их к свойствам внешнего компонента.
 */
async function addProperties(component: ComponentNode, r: RepeatGroup): Promise<number> {
  const sig = signature(await snapshot(component, 0, 16));
  let added = 0;
  for (const i of r.varyingAt.texts) {
    const slot = sig.texts[i];
    const node = slot?.id ? await figma.getNodeByIdAsync(slot.id) : null;
    if (!node || node.type !== 'TEXT' || insideInstance(node, component)) continue;
    try {
      const prop = component.addComponentProperty(`${slot.name.replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'Текст'} ${i + 1}`, 'TEXT', node.characters);
      node.componentPropertyReferences = { characters: prop };
      added++;
    } catch {
      // слой нельзя привязать — останется текстом черновика
    }
  }
  for (const i of r.varyingAt.icons) {
    const id = sig.iconIds[i];
    const node = id ? await figma.getNodeByIdAsync(id) : null;
    if (!node || node.type !== 'INSTANCE' || insideInstance(node, component)) continue;
    const main = await node.getMainComponentAsync();
    if (!main) continue;
    try {
      const prop = component.addComponentProperty(`Иконка ${i + 1}`, 'INSTANCE_SWAP', main.id);
      node.componentPropertyReferences = { mainComponent: prop };
      added++;
    } catch {
      // иконку нельзя привязать — останется как в примере
    }
  }
  return added;
}

async function card(r: RepeatGroup): Promise<FrameNode | null> {
  const example = await figma.getNodeByIdAsync(r.exampleNodeId);
  if (!example || example.type !== 'FRAME' || example.removed) return null;
  const t = proposalText(r);

  const box = stack('VERTICAL', `Предложение · ${t.title}`, 8);
  box.paddingTop = box.paddingBottom = box.paddingLeft = box.paddingRight = 16;
  box.cornerRadius = 12;
  box.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  box.strokes = [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }];

  box.appendChild(text(t.title, BOLD, 16));
  box.appendChild(text(t.meta, REGULAR, 12, 0.4));
  box.appendChild(text(t.props, REGULAR, 12, 0.25));
  const why = text(t.why, REGULAR, 12, 0.25);
  box.appendChild(why);

  const link = text(`Показать пример — экран «${r.exampleScreen}»`, REGULAR, 12);
  link.fills = [{ type: 'SOLID', color: { r: 0.05, g: 0.4, b: 0.9 } }];
  link.setRangeHyperlink(0, link.characters.length, { type: 'NODE', value: r.exampleNodeId });
  box.appendChild(link);

  const copy = example.clone();
  box.appendChild(copy);
  const draft = figma.createComponentFromNode(copy);
  draft.name = `Черновик / ${t.title}`;
  draft.description = `${t.why}. ${t.props}. Создан Components Swapper по ${r.count} местам — черновик, не опубликован.`;
  const props = await addProperties(draft, r);
  if (!props && (r.varyingAt.texts.length || r.varyingAt.icons.length)) {
    box.appendChild(text('Меняющиеся тексты и иконки — внутри вложенных компонентов: меняются их свойствами', REGULAR, 11, 0.5));
  }
  // Обоснование — по ширине черновика (не уже 320), переносится по строкам.
  why.resize(Math.max(320, draft.width), why.height);
  why.textAutoResize = 'HEIGHT';
  return box;
}

/** Карточки предложений по выбранным повторам — новым блоком справа от прежних. */
export async function propose(repeats: readonly RepeatGroup[], progress: (text: string) => void): Promise<ProposeResult> {
  await Promise.all([figma.loadFontAsync(REGULAR), figma.loadFontAsync(BOLD)]);
  const target = await page();
  await target.loadAsync();

  const container = stack('HORIZONTAL', `Предложения · ${new Date().toLocaleString('ru-RU')}`, 24);
  container.fills = [];
  container.counterAxisAlignItems = 'MIN';
  target.appendChild(container);
  const right = target.children.filter((n) => n !== container).reduce((x, n) => Math.max(x, n.x + n.width), 0);
  container.x = right ? right + 200 : 0;
  container.y = 0;

  const missing: string[] = [];
  let drafts = 0;
  for (let i = 0; i < repeats.length; i++) {
    progress(`Черновик ${i + 1} из ${repeats.length}: ${repeats[i].name}`);
    const box = await card(repeats[i]);
    if (!box) {
      missing.push(repeats[i].name);
      continue;
    }
    container.appendChild(box);
    drafts++;
  }
  if (!drafts) container.remove();
  return { pageId: target.id, containerId: container.id, drafts, missing };
}
