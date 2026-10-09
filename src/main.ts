// Код плагина в песочнице Figma: определяет, открыт ли файл библиотеки, и выполняет команды UI.

import libraries from '../config/libraries.json';
import { buildLookup, summarizeIndex, type LibraryKind } from './core/library-index';
import { buildReport } from './core/scan-report';
import { buildLibraryIndex } from './figma/index-library';
import { scanNodes } from './figma/scan';
import { loadIndexes, saveIndex, summaries } from './figma/store';
import type { LibraryInfo, ToPlugin, ToUi } from './shared/messages';

type LibraryConfig = (typeof libraries.libraries)[number];

const info = (l: LibraryConfig): LibraryInfo => ({ id: l.id, product: l.product, kind: l.kind as LibraryKind, name: l.name, short: l.short, url: l.url });
const post = (msg: ToUi) => figma.ui.postMessage(msg);
const progress = (text: string) => post({ type: 'progress', text });
const allIds = libraries.libraries.map((l) => l.id);

/** Файл библиотеки — по fileKey (нужен enablePrivatePluginApi). */
const library = libraries.libraries.find((l) => l.fileKey === figma.fileKey);

figma.showUI(__html__, { width: 420, height: 600, themeColors: true });

void (async () => {
  post({ type: 'init', library: library ? info(library) : null, libraries: libraries.libraries.map(info), indexes: summaries(await loadIndexes(allIds)) });
})();

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
  const indexes = await loadIndexes(allIds);
  if (!indexes.length) throw new Error('Нет ни одного индекса библиотек: откройте файл библиотеки и соберите индекс.');
  const selection = figma.currentPage.selection;
  const scope = selection.length ? 'selection' : 'page';
  const roots = selection.length ? selection : figma.currentPage.children;
  const lookup = buildLookup(indexes);
  const found = await scanNodes(roots, lookup, progress);
  post({
    type: 'scanned',
    report: buildReport(found.instances, found.detached, lookup),
    scope,
    scopeName: scope === 'selection' ? `выделено: ${selection.length}` : figma.currentPage.name,
    unreadable: found.unreadable,
  });
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
    else if (msg.type === 'focus') await focus(msg.nodeId);
    else if (msg.type === 'open-library') figma.openExternal(msg.url);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
