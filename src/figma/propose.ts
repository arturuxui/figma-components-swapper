// Черновики новых компонентов (этап 4): страница «Components Swapper · Предложения» в файле макета, на ней карточки —
// название, где встречается, свойства, обоснование, ссылка на пример и черновик компонента. Сам макет не меняется:
// копируется пример.
//
// Черновик — копия примера, превращённая в компонент с именем на точку (`.Черновик / …` — не публикуется). Внутри
// него, где можно, — наши компоненты (ручные копии и составные — как в 2б/2в, чужие экземпляры — по имени, как
// в этапе 1) и экземпляры черновиков вложенных повторов (строка внутри меню — свой черновик). Меняющиеся тексты и
// иконки — свойства компонента.

import type { KeyHit } from '../core/library-index';
import { matchManual } from '../core/manual';
import { matchByName, type Candidate } from '../core/match';
import { PROPOSALS_PAGE, proposalText } from '../core/proposal';
import { repeatKey, type RepeatGroup } from '../core/repeats';
import { shapeOf, signature, type StructNode } from '../core/structure';
import { place, replaceFrame } from './replace-frame';
import { SCREEN_DEPTH, snapshot } from './structure';
import { swapInstance } from './swap';

const REGULAR: FontName = { family: 'Inter', style: 'Regular' };
const BOLD: FontName = { family: 'Inter', style: 'Semi Bold' };
/** Точка в начале имени — компонент не публикуется с библиотекой. */
const DRAFT = '.Черновик';

export interface ProposeContext {
  /** Все повторы скана, вместе с вложенными (`nestedIn`). */
  all: readonly RepeatGroup[];
  byName: ReadonlyMap<string, Candidate[]>;
  lookup: ReadonlyMap<string, KeyHit>;
  product?: string;
}

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
  f.fills = [];
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
function insideInstance(node: BaseNode, root: BaseNode): boolean {
  for (let p = node.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true;
  return false;
}

/** Обход снимка черновика: `visit` возвращает true, если узел обработан и внутрь идти не нужно. */
async function walk(root: StructNode, visit: (n: StructNode) => Promise<boolean>): Promise<void> {
  const go = async (n: StructNode, isRoot: boolean): Promise<void> => {
    if (!isRoot && (n.visible === false || n.type === 'INSTANCE')) return;
    if (!isRoot && (await visit(n))) return;
    for (const c of n.children ?? []) await go(c, false);
  };
  await go(root, true);
}

async function frameById(id?: string): Promise<FrameNode | null> {
  const node = id ? await figma.getNodeByIdAsync(id) : null;
  return node && node.type === 'FRAME' && !node.removed ? node : null;
}

/** Наш компонент для фрейма — подбор ручных копий и составных (2б/2в). */
function oursFor(n: StructNode, ctx: ProposeContext) {
  if (n.type !== 'FRAME' || !n.children?.length) return null;
  const m = matchManual(
    { nodeId: n.id ?? '', name: n.name, screen: { id: '', name: '' }, width: n.width, height: n.height, shape: shapeOf(signature(n)), visual: !!n.visual },
    ctx.byName,
    ctx.product,
  );
  return m.status !== 'none' && m.target ? m.target : null;
}

/**
 * Начинка черновика — сначала наши, потом другие кандидаты:
 * 1) ручные копии наших и составные (подбор 2б/2в) → наши компоненты;
 * 2) оставшиеся фреймы-места вложенных повторов → экземпляры их черновиков;
 * 3) чужие и локальные экземпляры → наши по имени (только уверенные пары, как в этапе 1).
 * Возвращает имена подставленного.
 */
async function fill(draft: ComponentNode, inner: ReadonlyMap<string, ComponentNode>, ctx: ProposeContext): Promise<{ ours: string[]; drafts: string[] }> {
  const ours: string[] = [];
  const drafts: string[] = [];

  await walk(await snapshot(draft, 0, SCREEN_DEPTH), async (n) => {
    const target = oursFor(n, ctx);
    const frame = target ? await frameById(n.id) : null;
    if (!frame || !target) return false;
    try {
      await replaceFrame(frame, target, { byName: ctx.byName, product: ctx.product });
      frame.remove();
      ours.push(target.name);
      return true;
    } catch {
      return false;
    }
  });

  await walk(await snapshot(draft, 0, SCREEN_DEPTH), async (n) => {
    const comp = n.type === 'FRAME' ? inner.get(`r:${repeatKey(n)}`) : undefined;
    const frame = comp ? await frameById(n.id) : null;
    if (!comp || !frame) return false;
    place(comp.createInstance(), frame);
    frame.remove();
    drafts.push(comp.name);
    return true;
  });

  const draftIds = new Set([...inner.values()].map((c) => c.id));
  for (const node of draft.findAllWithCriteria({ types: ['INSTANCE'] })) {
    if (node.removed || insideInstance(node, draft)) continue;
    const main = await node.getMainComponentAsync();
    if (!main || draftIds.has(main.id)) continue;
    const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : null;
    if (ctx.lookup.has(set?.key ?? '') || ctx.lookup.has(main.key)) continue;
    const m = matchByName(set?.name ?? main.name, node, ctx.byName, ctx.product);
    if (m.status !== 'exact' || !m.target) continue;
    try {
      await swapInstance(node, m.target);
      ours.push(m.target.name);
    } catch {
      // не импортировался — останется как в примере
    }
  }
  return { ours, drafts };
}

/** Слои меняющихся текстов и иконок — запоминаются до начинки (она меняет порядок слоёв). */
async function varyingNodes(draft: ComponentNode, r: RepeatGroup): Promise<{ texts: { id: string; name: string; i: number }[]; icons: { id: string; i: number }[] }> {
  const sig = signature(await snapshot(draft, 0, SCREEN_DEPTH));
  return {
    texts: r.varyingAt.texts.flatMap((i) => (sig.texts[i]?.id ? [{ id: sig.texts[i].id!, name: sig.texts[i].name, i }] : [])),
    icons: r.varyingAt.icons.flatMap((i) => (sig.iconIds[i] ? [{ id: sig.iconIds[i]!, i }] : [])),
  };
}

/**
 * Меняющиеся тексты и иконки — свойства компонента (текст и замена экземпляра). Слои, которые после начинки
 * оказались внутри вложенных экземпляров или исчезли, пропускаются: Figma не даёт привязать их к внешнему.
 */
async function bindProperties(draft: ComponentNode, slots: Awaited<ReturnType<typeof varyingNodes>>): Promise<number> {
  let added = 0;
  for (const { id, name, i } of slots.texts) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed || node.type !== 'TEXT' || insideInstance(node, draft)) continue;
    try {
      const prop = draft.addComponentProperty(`${name.replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'Текст'} ${i + 1}`, 'TEXT', node.characters);
      node.componentPropertyReferences = { characters: prop };
      added++;
    } catch {
      // слой нельзя привязать — останется текстом черновика
    }
  }
  for (const { id, i } of slots.icons) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed || node.type !== 'INSTANCE' || insideInstance(node, draft)) continue;
    const main = await node.getMainComponentAsync();
    if (!main) continue;
    try {
      const prop = draft.addComponentProperty(`Иконка ${i + 1}`, 'INSTANCE_SWAP', main.id);
      node.componentPropertyReferences = { mainComponent: prop };
      added++;
    } catch {
      // иконку нельзя привязать — останется как в примере
    }
  }
  return added;
}

/** Черновик повтора: копия примера → компонент → начинка → свойства. Пример исчез — null. */
async function draftOf(r: RepeatGroup, name: string, parent: FrameNode, inner: ReadonlyMap<string, ComponentNode>, ctx: ProposeContext) {
  const example = await frameById(r.exampleNodeId);
  if (!example) return null;
  const copy = example.clone();
  parent.appendChild(copy);
  const draft = figma.createComponentFromNode(copy);
  draft.name = name;
  const slots = await varyingNodes(draft, r);
  const inside = await fill(draft, inner, ctx);
  const props = await bindProperties(draft, slots);
  const t = proposalText(r);
  draft.description = `${t.why}. ${t.props}. Создан Components Swapper по ${r.count} местам — черновик, не опубликован.`;
  return { draft, inside, props };
}

const area = (r: RepeatGroup) => r.width * r.height;
const uniq = (names: string[]) => [...new Set(names)].join(', ');

async function card(r: RepeatGroup, ctx: ProposeContext): Promise<FrameNode | null> {
  if (!(await frameById(r.exampleNodeId))) return null;
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

  // Сначала черновики вложенных повторов (от мелких к крупным: крупный может содержать мелкий), потом главный.
  const nested = ctx.all.filter((g) => g.nestedIn === r.id).sort((a, b) => area(a) - area(b));
  const innerRow = stack('HORIZONTAL', 'Вложенные черновики', 16);
  const inner = new Map<string, ComponentNode>();
  for (const g of nested) {
    // Вложенный повтор, который сам — копия нашего компонента, черновиком не делаем: на его месте будет наш.
    const example = await frameById(g.exampleNodeId);
    if (g.likeOurs || !example || oursFor(await snapshot(example, 0, SCREEN_DEPTH), ctx)) continue;
    const made = await draftOf(g, `${DRAFT} / ${t.title} / ${g.name}`, innerRow, inner, ctx);
    if (made) inner.set(g.id, made.draft);
  }
  const main = await draftOf(r, `${DRAFT} / ${t.title}`, box, inner, ctx);
  if (!main) {
    box.remove();
    innerRow.remove();
    return null;
  }

  const notes: string[] = [];
  if (main.inside.ours.length) notes.push(`Внутри — наши: ${uniq(main.inside.ours)}`);
  if (main.inside.drafts.length) notes.push(`вложенные черновики: ${uniq(main.inside.drafts.map((n) => n.split(' / ').pop() ?? n))}`);
  if (!main.props && (r.varyingAt.texts.length || r.varyingAt.icons.length)) notes.push('меняющиеся тексты и иконки — внутри вложенных компонентов, меняются их свойствами');
  if (notes.length) box.insertChild(box.children.indexOf(link) + 1, text(notes.join('; '), REGULAR, 11, 0.5));

  if (inner.size) {
    box.appendChild(text('Вложенные черновики', BOLD, 12));
    box.appendChild(innerRow);
  } else innerRow.remove();

  // Обоснование — по ширине черновика (не уже 320), переносится по строкам.
  why.resize(Math.max(320, main.draft.width), why.height);
  why.textAutoResize = 'HEIGHT';
  return box;
}

/** Карточки предложений по выбранным повторам — новым блоком справа от прежних. */
export async function propose(chosen: readonly RepeatGroup[], ctx: ProposeContext, progress: (text: string) => void): Promise<ProposeResult> {
  await Promise.all([figma.loadFontAsync(REGULAR), figma.loadFontAsync(BOLD)]);
  const target = await page();
  await target.loadAsync();

  const container = stack('HORIZONTAL', `Предложения · ${new Date().toLocaleString('ru-RU')}`, 24);
  container.counterAxisAlignItems = 'MIN';
  target.appendChild(container);
  const right = target.children.filter((n) => n !== container).reduce((x, n) => Math.max(x, n.x + n.width), 0);
  container.x = right ? right + 200 : 0;
  container.y = 0;

  const missing: string[] = [];
  let drafts = 0;
  for (let i = 0; i < chosen.length; i++) {
    progress(`Черновик ${i + 1} из ${chosen.length}: ${chosen[i].name}`);
    const box = await card(chosen[i], ctx);
    if (!box) {
      missing.push(chosen[i].name);
      continue;
    }
    container.appendChild(box);
    drafts++;
  }
  if (!drafts) container.remove();
  return { pageId: target.id, containerId: container.id, drafts, missing };
}
