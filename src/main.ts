// Код плагина в песочнице Figma: определяет, открыт ли файл библиотеки, и выполняет команды UI.

import libraries from '../config/libraries.json';
import { buildLookup, summarizeIndex, type KeyHit, type LibraryIndex, type LibraryKind } from './core/library-index';
import { buildCandidates, guessProduct, matchByName, type Candidate } from './core/match';
import { buildReport, type ReportGroup, type ScanReport } from './core/scan-report';
import { applySwaps, undoSwaps } from './figma/apply';
import { buildLibraryIndex } from './figma/index-library';
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
let last: { report: ScanReport; byName: Map<string, Candidate[]>; lookup: Map<string, KeyHit>; products: string[]; product: string | null } | null = null;

/** Группы, которые надо менять: чужие и локальные экземпляры (отвязанные фреймы — этап 2). */
const toReplace = (report: ScanReport) => report.groups.filter((g) => !g.detached && g.origin !== 'ours');

function sendMatches(product: string | null) {
  if (!last) return;
  last.product = product;
  const matches: Matches = {};
  for (const g of toReplace(last.report)) matches[g.id] = matchByName(g.name, g, last.byName, product ?? undefined);
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
  const indexes: LibraryIndex[] = await loadIndexes(allIds);
  if (!indexes.length) throw new Error('Нет ни одного индекса библиотек: откройте файл библиотеки и соберите индекс.');
  const selection = figma.currentPage.selection;
  const scope = selection.length ? 'selection' : 'page';
  const roots = selection.length ? selection : figma.currentPage.children;
  const lookup = buildLookup(indexes);
  const found = await scanNodes(roots, lookup, progress);
  const report = buildReport(found.instances, found.detached, lookup);
  const byName = buildCandidates(indexes);
  last = { report, byName, lookup, products: [...new Set(indexes.map((i) => i.product))].sort(), product: null };
  post({
    type: 'scanned',
    report,
    scope,
    scopeName: scope === 'selection' ? `выделено: ${selection.length}` : figma.currentPage.name,
    unreadable: found.unreadable,
  });
  sendMatches(guessProduct(toReplace(report), byName) ?? last.products[0] ?? null);
}

async function preview(groupId: string, target: { key: string; isSet: boolean }) {
  const group: ReportGroup | undefined = last ? toReplace(last.report).find((g) => g.id === groupId) : undefined;
  if (!group) throw new Error('Группа не найдена — пересканируйте макет.');
  const result = await previewSwap(group.exampleNodeId, target);
  post({ type: 'preview', groupId, targetKey: target.key, ...result });
}

async function apply(choices: { groupId: string; target: { key: string; isSet: boolean } }[]) {
  if (!last) throw new Error('Сначала просканируйте макет.');
  const groups = toReplace(last.report);
  const selected = choices.flatMap(({ groupId, target }) => {
    const g = groups.find((x) => x.id === groupId);
    return g ? [{ name: g.name, nodeIds: g.nodeIds, target }] : [];
  });
  if (!selected.length) throw new Error('Не выбрано ни одной замены.');
  const result = await applySwaps(selected, { lookup: last.lookup, byName: last.byName, product: last.product ?? undefined, progress });
  // Скан устарел: заменённые места больше не чужие.
  last = null;
  post({ type: 'applied', result });
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

figma.ui.onmessage = async (msg: ToPlugin) => {
  try {
    if (msg.type === 'build-index') await buildIndex();
    else if (msg.type === 'scan') await scan();
    else if (msg.type === 'set-product') sendMatches(msg.product);
    else if (msg.type === 'preview') await preview(msg.groupId, msg.target);
    else if (msg.type === 'apply') await apply(msg.choices);
    else if (msg.type === 'undo') post({ type: 'undone', ...undoSwaps(progress) });
    else if (msg.type === 'focus') await focus(msg.nodeId);
    else if (msg.type === 'open-library') figma.openExternal(msg.url);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
