// Код плагина в песочнице Figma: определяет, открыт ли файл библиотеки, и выполняет команды UI.

import libraries from '../config/libraries.json';
import { buildLookup, summarizeIndex, type KeyHit, type LibraryIndex, type LibraryKind } from './core/library-index';
import { groupManual, matchManual, type ManualFinding } from './core/manual';
import { buildCandidates, guessProduct, matchByName, normalizeName, SIZE_TOLERANCE, type Candidate, type MatchResult } from './core/match';
import { shapeOf, signature } from './core/structure';
import { groupOverrides, type InstanceOverrides, type OverrideChoice, type OverrideGroup } from './core/overrides';
import { findRepeats, type RepeatGroup } from './core/repeats';
import { propose } from './figma/propose';
import { hasVisual, snapshot } from './figma/structure';
import { screenTrees } from './figma/repeats';
import { buildReport, type ReportGroup, type ScanReport } from './core/scan-report';
import { applySwaps, finalizeFrames, undoSwaps } from './figma/apply';
import { buildLibraryIndex } from './figma/index-library';
import { proposeImprovements } from './figma/improve';
import { realOverrides } from './figma/overrides';
import { previewSwap } from './figma/preview';
import { scanNodes } from './figma/scan';
import { loadIndexes, saveIndex, summaries } from './figma/store';
import type { LibraryInfo, Matches, ToPlugin, ToUi } from './shared/messages';

type LibraryConfig = (typeof libraries.libraries)[number];

const info = (l: LibraryConfig): LibraryInfo => ({ id: l.id, product: l.product, kind: l.kind as LibraryKind, name: l.name, short: l.short, url: l.url });
const post = (msg: ToUi) => figma.ui.postMessage(msg);
const progress = (text: string) => post({ type: 'progress', text });
const allIds = libraries.libraries.map((l) => l.id);

/** Файл библиотеки — по fileKey (нужен enablePrivatePluginApi). */
const library = libraries.libraries.find((l) => l.fileKey === figma.fileKey);

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

void (async () => {
  post({ type: 'init', library: library ? info(library) : null, libraries: libraries.libraries.map(info), indexes: summaries(await loadIndexes(allIds)) });
})();

/** Последний скан: по нему подбираются пары, делается примерка и (этап 1в) замена. */
let last: {
  report: ScanReport;
  byName: Map<string, Candidate[]>;
  lookup: Map<string, KeyHit>;
  products: string[];
  product: string | null;
  /** Ручные фреймы: id группы → первый фрейм группы (по нему подбирается пара). */
  manual: Map<string, ManualFinding>;
  /** Повторы — кандидаты в новые компоненты (этап 4). */
  repeats: RepeatGroup[];
  /** Расхождения заменяемых экземпляров со своим компонентом (этап 5). */
  overrides: OverrideGroup[];
} | null = null;

/**
 * Этап 5: реальные расхождения экземпляров, которые заменяем, со своим (старым) компонентом — по группам отчёта.
 * При замене их судьбу решает пользователь (правило 17 скилла).
 */
async function overridesOf(groups: readonly ReportGroup[], screenOf: Map<string, { id: string; name: string }>): Promise<OverrideGroup[]> {
  const out: OverrideGroup[] = [];
  const total = groups.reduce((n, g) => n + g.nodeIds.length, 0);
  let done = 0;
  for (const g of groups) {
    const items: InstanceOverrides[] = [];
    for (const id of g.nodeIds) {
      if (++done % 200 === 0) progress(`Расхождения с компонентами: ${done} из ${total}`);
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.type !== 'INSTANCE') continue;
      items.push({ nodeId: id, screen: screenOf.get(id) ?? { id: '', name: '' }, diffs: await realOverrides(node) });
    }
    out.push(...groupOverrides(g.id, items));
  }
  return out;
}

/** Чужие и локальные экземпляры — по ним угадывается продукт макета. */
const toReplace = (report: ScanReport) => report.groups.filter((g) => !g.detached && !g.manual && g.origin !== 'ours');
/** Всё, что можно заменить: чужие и локальные экземпляры (этап 1) и отвязанные фреймы (этап 2). */
const replaceable = (report: ScanReport) => report.groups.filter((g) => g.detached || g.origin !== 'ours');

/** Пара для группы: отвязанный от нашего — тот самый компонент; ручной фрейм — по имени и устройству; остальное — по имени. */
function matchFor(g: ReportGroup, byName: Map<string, Candidate[]>, lookup: Map<string, KeyHit>, product: string | null): MatchResult {
  const manual = g.manual ? last?.manual.get(g.id) : undefined;
  if (manual) return matchManual(manual, byName, product ?? undefined);
  const hit = g.detachedKey ? lookup.get(g.detachedKey) : undefined;
  if (g.detached && g.origin === 'ours' && g.detachedKey && hit) {
    const own: Candidate = { key: g.detachedKey, isSet: false, name: hit.name, libraryId: hit.libraryId, product: hit.product, kind: hit.kind, sizes: [{ width: g.width, height: g.height }] };
    return { status: 'exact', target: own, alternatives: [own] };
  }
  return matchByName(g.name, g, byName, product ?? undefined);
}

function sendMatches(product: string | null) {
  if (!last) return;
  last.product = product;
  const matches: Matches = {};
  for (const g of replaceable(last.report)) matches[g.id] = matchFor(g, last.byName, last.lookup, product);
  post({ type: 'matched', product, products: last.products, matches });
}

async function buildIndex() {
  if (!library) throw new Error('Индекс собирается в файле библиотеки WB AID.');
  const index = await buildLibraryIndex(
    { libraryId: library.id, product: library.product, kind: library.kind as LibraryKind, fileKey: library.fileKey },
    progress,
  );
  if (!index.entries.length) throw new Error('В файле не нашлось компонентов для индекса.');
  await saveIndex(index);
  post({ type: 'indexed', summary: summarizeIndex(index) });
}

async function scan() {
  // Фреймы, заменённые прошлым применением, удаляются окончательно — их отмена больше недоступна.
  finalizeFrames();
  const indexes: LibraryIndex[] = await loadIndexes(allIds);
  if (!indexes.length) throw new Error('Нет ни одного индекса библиотек: откройте файл библиотеки и соберите индекс.');
  const selection = figma.currentPage.selection;
  const scope = selection.length ? 'selection' : 'page';
  const roots = selection.length ? selection : figma.currentPage.children;
  const lookup = buildLookup(indexes);
  const byName = buildCandidates(indexes);
  const found = await scanNodes(roots, lookup, progress, manualFilter(byName));
  const report = buildReport(found.instances, found.detached, lookup);
  const manual = await manualFindings(found.manual);
  const firstOf = new Map(manual.map((f) => [f.nodeId, f]));
  // В отчёт — только ручные фреймы, для которых нашлась пара: остальное — обычная вёрстка.
  const guess = guessProduct(toReplace(report), byName);
  const manualGroups = groupManual(manual).filter((g) => matchManual(firstOf.get(g.exampleNodeId)!, byName, guess).status !== 'none');
  report.groups.push(...manualGroups);
  // Этап 4: повторы, которые не наши компоненты и не их копии, — кандидаты в новые компоненты.
  const ours = [...byName.values()].flat().filter((c) => !guess || c.product === guess);
  const repeats = findRepeats(await screenTrees(roots, progress), new Set(manualGroups.flatMap((g) => g.nodeIds)), ours);
  const overrides = await overridesOf(toReplace(report), new Map(found.instances.map((f) => [f.nodeId, f.screen])));
  last = {
    report,
    byName,
    lookup,
    products: [...new Set(indexes.map((i) => i.product))].sort(),
    product: null,
    manual: new Map(manualGroups.map((g) => [g.id, firstOf.get(g.exampleNodeId)!])),
    repeats,
    overrides,
  };
  post({
    type: 'scanned',
    report,
    scope,
    scopeName: scope === 'selection' ? `выделено: ${selection.length}` : figma.currentPage.name,
    unreadable: found.unreadable,
    repeats,
    overrides,
  });
  sendMatches(guess ?? last.products[0] ?? null);
}

/**
 * Быстрый отбор ручных фреймов при скане, без снимка устройства: имя как у нашего компонента, или своё
 * оформление и размер как у одного из наших вариантов (±20 %).
 */
function manualFilter(byName: Map<string, Candidate[]>): (node: FrameNode) => boolean {
  const sizes: { width: number; height: number }[] = [];
  for (const list of byName.values()) for (const c of list) if (c.kind !== 'icons') sizes.push(...c.sizes);
  const near = (a: number, b: number) => Math.abs(a - b) <= SIZE_TOLERANCE * Math.max(a, b);
  return (node) => {
    if (byName.has(normalizeName(node.name))) return true;
    if (!hasVisual(node)) return false;
    return sizes.some((s) => near(node.width, s.width) && near(node.height, s.height));
  };
}

async function manualFindings(nodes: { node: FrameNode; screen: { id: string; name: string } }[]): Promise<ManualFinding[]> {
  const out: ManualFinding[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i % 50 === 0) progress(`Устройство фреймов: ${i} из ${nodes.length}`);
    const { node, screen } = nodes[i];
    const shape = shapeOf(signature(await snapshot(node)));
    out.push({ nodeId: node.id, name: node.name, screen, width: node.width, height: node.height, shape, visual: hasVisual(node) });
  }
  return out;
}

async function preview(groupId: string, target: { key: string; isSet: boolean }) {
  const group: ReportGroup | undefined = last ? replaceable(last.report).find((g) => g.id === groupId) : undefined;
  if (!group || !last) throw new Error('Группа не найдена — пересканируйте макет.');
  const result = await previewSwap(group.exampleNodeId, target, { byName: last.byName, product: last.product ?? undefined });
  post({ type: 'preview', groupId, targetKey: target.key, ...result });
}

async function apply(choices: { groupId: string; target: { key: string; isSet: boolean } }[], overrideChoices: Record<string, OverrideChoice> = {}) {
  if (!last) throw new Error('Сначала просканируйте макет.');
  const groups = replaceable(last.report);
  const selected = choices.flatMap(({ groupId, target }) => {
    const g = groups.find((x) => x.id === groupId);
    return g ? [{ name: g.name, nodeIds: g.nodeIds, target }] : [];
  });
  if (!selected.length) throw new Error('Не выбрано ни одной замены.');
  // Экземпляры с расхождениями → выбор пользователя по их группе расхождений (не решено — null).
  const overrides = new Map<string, OverrideChoice | null>();
  for (const o of last.overrides) for (const id of o.nodeIds) overrides.set(id, overrideChoices[o.id] ?? null);
  const result = await applySwaps(selected, { lookup: last.lookup, byName: last.byName, product: last.product ?? undefined, progress, overrides });
  // «Нужен вариант» — карточки доработок на странице предложений (после замены: на карточке — уже наш экземпляр).
  const targetOf = new Map(choices.map((c) => [c.groupId, c.target.key]));
  const variants = last.overrides
    .filter((o) => overrideChoices[o.id] === 'variant' && targetOf.has(o.groupId))
    .map((o) => {
      const key = targetOf.get(o.groupId)!;
      const name = last!.lookup.get(key)?.name ?? groups.find((g) => g.id === o.groupId)?.name ?? '';
      return { group: o, ours: name.split(' / ')[0] };
    });
  improvementsBlock = null;
  const improved = await proposeImprovements(variants, progress);
  if (improved) {
    improvementsBlock = improved.containerId;
    const page = (await figma.getNodeByIdAsync(improved.pageId)) as PageNode;
    result.improvements = { pageName: page.name, cards: improved.cards };
  }
  // Скан устарел: заменённые места больше не чужие.
  last = null;
  post({ type: 'applied', result });
}

/** Блок карточек доработок последнего применения — «Отменить» убирает и его. */
let improvementsBlock: string | null = null;

async function undo() {
  const result = await undoSwaps(progress);
  if (improvementsBlock) {
    const block = await figma.getNodeByIdAsync(improvementsBlock);
    if (block && !block.removed) block.remove();
    improvementsBlock = null;
  }
  post({ type: 'undone', ...result });
}

async function focus(nodeId: string) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') throw new Error('Слой не найден — возможно, его удалили.');
  let page: BaseNode | null = node;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page as PageNode);
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

/** Черновики выбранных повторов на странице предложений; страница открывается, блок выделяется. */
async function proposeDrafts(ids: string[]) {
  const chosen = (last?.repeats ?? []).filter((r) => ids.includes(r.id));
  if (!chosen.length) throw new Error('Не выбрано ни одного повтора — пересканируйте макет.');
  const result = await propose(chosen, { all: last!.repeats, byName: last!.byName, lookup: last!.lookup, product: last!.product ?? undefined }, progress);
  try {
    figma.commitUndo();
  } catch {
    // нет API — страницу можно удалить руками
  }
  const page = (await figma.getNodeByIdAsync(result.pageId)) as PageNode;
  const block = await figma.getNodeByIdAsync(result.containerId);
  if (result.drafts && block) {
    await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [block as SceneNode];
    figma.viewport.scrollAndZoomIntoView([block as SceneNode]);
  }
  post({ type: 'proposed', pageName: page.name, drafts: result.drafts, missing: result.missing });
}

/** Выделить все места повтора (на текущей странице). */
async function select(nodeIds: string[]) {
  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const n = await figma.getNodeByIdAsync(id);
    if (n && n.type !== 'DOCUMENT' && n.type !== 'PAGE' && !n.removed) nodes.push(n as SceneNode);
  }
  if (!nodes.length) throw new Error('Слои не найдены — пересканируйте макет.');
  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
}

figma.on('close', finalizeFrames);

figma.ui.onmessage = async (msg: ToPlugin) => {
  try {
    if (msg.type === 'build-index') await buildIndex();
    else if (msg.type === 'scan') await scan();
    else if (msg.type === 'set-product') sendMatches(msg.product);
    else if (msg.type === 'preview') await preview(msg.groupId, msg.target);
    else if (msg.type === 'apply') await apply(msg.choices, msg.overrides);
    else if (msg.type === 'undo') await undo();
    else if (msg.type === 'focus') await focus(msg.nodeId);
    else if (msg.type === 'select') await select(msg.nodeIds);
    else if (msg.type === 'propose') await proposeDrafts(msg.ids);
    else if (msg.type === 'open-library') figma.openExternal(msg.url);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
