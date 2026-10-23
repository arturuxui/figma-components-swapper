// Код плагина в песочнице Figma: определяет, открыт ли файл библиотеки, и выполняет команды UI.

import libraries from '../config/libraries.json';
import { adoptionItem, adoptionJson, countAdoption } from './core/adoption';
import { buildLookup, summarizeIndex, type KeyHit, type LibraryIndex, type LibraryKind } from './core/library-index';
import { groupManual, matchManual, type ManualFinding } from './core/manual';
import { buildCandidates, guessProduct, iconCandidates, resolveChoice, matchByName, matchIcon, normalizeName, samePrint, SIZE_TOLERANCE, type Candidate, type LayoutIcon, type MatchResult } from './core/match';
import { glyphOf, printIcon } from './core/icon-shape';
import { iconColor, iconPaths } from './figma/icon-geometry';
import { shapeOf, signature } from './core/structure';
import { groupOverrides, type InstanceOverrides, type OverrideChoice, type OverrideGroup } from './core/overrides';
import { findRepeats, type RepeatGroup } from './core/repeats';
import { propose } from './figma/propose';
import { hasVisual, snapshot } from './figma/structure';
import { screenTrees } from './figma/repeats';
import { buildReport, type ReportGroup, type ScanReport } from './core/scan-report';
import { applySwaps, finalizeFrames, settleOurs, undoSwaps, type ApplyResult } from './figma/apply';
import { buildLibraryIndex } from './figma/index-library';
import { proposeImprovements, type Improvement } from './figma/improve';
import { realOverrides } from './figma/overrides';
import { previewSwap } from './figma/preview';
import { chooseComponent, importTarget } from './figma/swap';
import { measurePages } from './figma/measure';
import { loadRenames } from './figma/renames';
import { renameAliases, staleness } from './core/renames';
import { scanNodes } from './figma/scan';
import { loadIndexes, saveIndex, summaries } from './figma/store';
import type { IconCheck, LibraryInfo, Matches, RenameCheck, ToPlugin, ToUi } from './shared/messages';

type LibraryConfig = (typeof libraries.libraries)[number];

const info = (l: LibraryConfig): LibraryInfo => ({ id: l.id, product: l.product, kind: l.kind as LibraryKind, name: l.name, short: l.short, url: l.url });
const post = (msg: ToUi) => figma.ui.postMessage(msg);
const progress = (text: string) => post({ type: 'progress', text });
const allIds = libraries.libraries.map((l) => l.id);
/** Библиотеки AID — подбор и «наше». Старые библиотеки (`legacy`) — только для замера внедрения: legacy vs other. */
const aidIds = libraries.libraries.filter((l) => l.kind !== 'legacy').map((l) => l.id);
const legacyIds = libraries.libraries.filter((l) => l.kind === 'legacy').map((l) => l.id);

/** Файл библиотеки — по fileKey (нужен enablePrivatePluginApi). */
const library = libraries.libraries.find((l) => l.fileKey === figma.fileKey);

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

void (async () => {
  post({
    type: 'init',
    library: library ? info(library) : null,
    libraries: libraries.libraries.map(info),
    indexes: summaries(await loadIndexes(allIds)),
    pages: figma.root.children.map((p) => ({ id: p.id, name: p.name })),
    currentPageId: figma.currentPage.id,
  });
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
  /** Иконки макета для подбора по рисунку (этап 3): id группы → рисунок примера. */
  icons: Map<string, LayoutIcon>;
  /** Проверка отпечатков по актуальной библиотеке: что изменилось и удалено с момента индекса. */
  iconCheck: IconCheck;
  /** Карта переименований библиотек (AID-LU-18): что из неё взято в подбор. */
  renameCheck: RenameCheck;
} | null = null;

/** Размер иконки в макете (как у плагина на этапе 1 — до 48 px). */
const ICON_MAX = 48;
/** Сколько экземпляров группы просмотреть в поисках непустого рисунка. */
const EXAMPLES_MAX = 20;

/** Рисунок примера группы — для групп размером с иконку, которые можно заменить экземпляром. */
async function layoutIcons(groups: readonly ReportGroup[]): Promise<Map<string, LayoutIcon>> {
  const out = new Map<string, LayoutIcon>();
  for (const g of groups) {
    if (g.detached || g.manual || Math.max(g.width, g.height) > ICON_MAX || Math.min(g.width, g.height) < 8) continue;
    // Пример бывает пустым (скрыт, без слоёв — замер Rider: ic_add_circle) — берём рисунок у следующих,
    // а если пусты все — у их главного компонента.
    let first: InstanceNode | null = null;
    for (const id of g.nodeIds.slice(0, EXAMPLES_MAX)) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.type !== 'INSTANCE') continue;
      first ??= node;
      const paths = iconPaths(node);
      if (!paths.length) continue;
      out.set(g.id, { print: printIcon(paths), glyph: glyphOf(paths), multicolor: iconColor(node).multicolor, name: g.name });
      break;
    }
    const main = !out.has(g.id) && first ? await first.getMainComponentAsync().catch(() => null) : null;
    const paths = main ? iconPaths(main) : [];
    if (main && paths.length) out.set(g.id, { print: printIcon(paths), glyph: glyphOf(paths), multicolor: iconColor(main).multicolor, name: g.name });
  }
  return out;
}

/**
 * Отпечатки в индексе могли устареть: иконку в библиотеке перерисовали или удалили. Иконки, которые подбор
 * предлагает, подгружаем из библиотеки (актуальная опубликованная версия) и сверяем: перерисованная — подбор
 * по новому рисунку, удалённая — из подбора уходит. Новые иконки так не найти — только пересборкой индекса.
 */
async function checkIcons(icons: Map<string, LayoutIcon>, byName: Map<string, Candidate[]>, product: string | undefined): Promise<IconCheck> {
  const check: IconCheck = { checked: 0, changed: [], removed: [] };
  const all = iconCandidates(byName, product);
  const offered = new Map<string, Candidate>();
  for (const icon of icons.values()) for (const c of matchIcon(icon, all).alternatives) offered.set(c.key, c);
  for (const c of offered.values()) {
    progress(`Сверка иконок с библиотекой: ${++check.checked} из ${offered.size}`);
    const fresh = await importTarget(c).catch(() => null);
    if (!fresh) {
      check.removed.push(c.name);
      for (const [k, list] of byName) byName.set(k, list.filter((x) => x.key !== c.key));
      continue;
    }
    const main = fresh.type === 'COMPONENT_SET' ? fresh.defaultVariant : fresh;
    const paths = iconPaths(main);
    const print = printIcon(paths);
    if (c.icon && !samePrint(c.icon.print, print)) {
      check.changed.push(c.name);
      c.icon = { print, glyph: glyphOf(paths), multicolor: iconColor(main).multicolor };
    }
  }
  return check;
}

/**
 * Этап 5: реальные расхождения экземпляров, которые заменяем, со своим (старым) компонентом — по группам отчёта.
 * При замене их судьбу решает пользователь (правило 17 скилла).
 */
async function overridesOf(
  groups: readonly ReportGroup[],
  screenOf: Map<string, { id: string; name: string }>,
  topOnly = false,
  targetOf: (g: ReportGroup) => Candidate | null = () => null,
): Promise<OverrideGroup[]> {
  const out: OverrideGroup[] = [];
  const total = groups.reduce((n, g) => n + g.nodeIds.length, 0);
  let done = 0;
  for (const g of groups) {
    // Есть точная пара — сравниваем с нашим компонентом (тем вариантом, что поставит замена).
    const target = targetOf(g);
    const ours = target ? await importTarget(target).catch(() => null) : null;
    const items: InstanceOverrides[] = [];
    for (const id of g.nodeIds) {
      if (++done % 200 === 0) progress(`Расхождения с компонентами: ${done} из ${total}`);
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.type !== 'INSTANCE') continue;
      // Наш экземпляр внутри другого экземпляра — часть того компонента, его расхождения считаются у внешнего.
      if (topOnly && insideInstance(node)) continue;
      const against = ours ? (await chooseComponent(ours, node)).component : undefined;
      items.push({ nodeId: id, screen: screenOf.get(id) ?? { id: '', name: '' }, diffs: await realOverrides(node, against) });
    }
    out.push(...groupOverrides(g.id, items));
  }
  return out;
}

function insideInstance(node: BaseNode): boolean {
  for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (p.type === 'INSTANCE') return true;
  return false;
}

/** Экземпляры наших компонентов (не отвязанные) — у них тоже бывают расхождения с компонентом (этап 5). */
const oursGroups = (report: ScanReport) => report.groups.filter((g) => !g.detached && !g.manual && g.origin === 'ours');

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
  const byNameResult = matchByName(g.name, g, byName, product ?? undefined);
  const icon = last?.icons.get(g.id);
  if (!icon || byNameResult.status === 'exact' || byNameResult.status === 'stretched') return byNameResult;
  const drawn = matchIcon(icon, iconCandidates(byName, product ?? undefined));
  if (drawn.status === 'none') return byNameResult;
  const extra = byNameResult.alternatives.filter((c) => !drawn.alternatives.some((d) => d.key === c.key));
  return { ...drawn, alternatives: [...drawn.alternatives, ...extra] };
}

function sendMatches(product: string | null) {
  if (!last) return;
  last.product = product;
  const matches: Matches = {};
  for (const g of replaceable(last.report)) matches[g.id] = matchFor(g, last.byName, last.lookup, product);
  post({ type: 'matched', product, products: last.products, matches, icons: last.iconCheck, renames: last.renameCheck });
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
  const indexes: LibraryIndex[] = await loadIndexes(aidIds);
  if (!indexes.length) throw new Error('Нет ни одного индекса библиотек: откройте файл библиотеки и соберите индекс.');
  const selection = figma.currentPage.selection;
  const scope = selection.length ? 'selection' : 'page';
  const roots = selection.length ? selection : figma.currentPage.children;
  const lookup = buildLookup(indexes);
  // Карта переименований: старые имена наших компонентов — в подбор, удалённые после индекса — из подбора.
  progress('Карта переименований библиотек…');
  const renames = await loadRenames(indexes.map((i) => i.libraryId));
  const renamed = renameAliases(renames.entries);
  const stale = staleness(renames.entries, indexes);
  const byName = buildCandidates(indexes, { renamed, removed: stale.removed });
  const renameCheck: RenameCheck = { entries: renames.entries.length, renamed: renamed.size, removed: stale.removedNames, added: stale.added, offline: renames.offline };
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
  const screenOf = new Map(found.instances.map((f) => [f.nodeId, f.screen]));
  const exact = (g: ReportGroup) => {
    const m = matchByName(g.name, g, byName, guess ?? undefined);
    return m.status === 'exact' && m.target ? m.target : null;
  };
  const overrides = [...(await overridesOf(toReplace(report), screenOf, false, exact)), ...(await overridesOf(oursGroups(report), screenOf, true))];
  progress('Иконки по рисунку…');
  const icons = await layoutIcons(toReplace(report));
  const iconCheck = await checkIcons(icons, byName, guess);
  last = {
    report,
    byName,
    lookup,
    products: [...new Set(indexes.map((i) => i.product))].sort(),
    product: null,
    manual: new Map(manualGroups.map((g) => [g.id, firstOf.get(g.exampleNodeId)!])),
    repeats,
    overrides,
    icons,
    iconCheck,
    renameCheck,
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
    if (!g) return [];
    const kind = resolveChoice(matchFor(g, last!.byName, last!.lookup, last!.product).alternatives, target.key)?.owner.kind;
    return [{ name: g.name, nodeIds: g.nodeIds, target, recolor: kind === 'icons' }];
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
  await addImprovements(result, variants);
  // Скан устарел: заменённые места больше не чужие.
  last = null;
  post({ type: 'applied', result });
}

/** Карточки «нужен вариант» — в итог применения; блок запоминается для «Отменить». */
async function addImprovements(result: ApplyResult, variants: Improvement[]) {
  improvementsBlock = null;
  const improved = await proposeImprovements(variants, progress);
  if (!improved) return;
  improvementsBlock = improved.containerId;
  const page = (await figma.getNodeByIdAsync(improved.pageId)) as PageNode;
  result.improvements = { pageName: page.name, cards: improved.cards };
}

/** Решения по расхождениям наших экземпляров (без замены). */
async function settle(overrideChoices: Record<string, OverrideChoice>) {
  if (!last) throw new Error('Сначала просканируйте макет.');
  const ours = new Map(oursGroups(last.report).map((g) => [g.id, g]));
  const chosen = last.overrides.filter((o) => ours.has(o.groupId) && overrideChoices[o.id]);
  if (!chosen.length) throw new Error('Не выбрано ни одного решения.');
  const result = await settleOurs(
    chosen.map((o) => ({ name: ours.get(o.groupId)!.name, nodeIds: o.nodeIds, choice: overrideChoices[o.id] })),
    progress,
  );
  await addImprovements(
    result,
    chosen.filter((o) => overrideChoices[o.id] === 'variant').map((o) => ({ group: o, ours: ours.get(o.groupId)!.name })),
  );
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

/**
 * Замер внедрения AID (AID-LU-19) по методике PD: экземпляры верхнего уровня выбранных страниц по источнику, иконки
 * отдельно; «готово к замене» — старые компоненты с уверенной парой по имени. Итог — счётчики и JSON точки замера.
 */
async function measure(pageIds: string[], product?: string) {
  if (!pageIds.length) throw new Error('Выберите хотя бы одну страницу.');
  const indexes = await loadIndexes(aidIds);
  if (!indexes.length) throw new Error('Нет ни одного индекса библиотек: откройте файл библиотеки и соберите индекс.');
  const lookup = buildLookup(indexes);
  const byName = buildCandidates(indexes);
  // Старые библиотеки продукта: их ключи делят внешнее на legacy и other. Ни одного индекса — всё внешнее legacy.
  const legacyIndexes = await loadIndexes(legacyIds);
  const legacy = legacyIndexes.length ? new Set(legacyIndexes.flatMap((i) => [...i.sets.map((x) => x.key), ...i.entries.map((e) => e.key)])) : undefined;
  const { findings, unreadable, inSets } = await measurePages(pageIds, progress);
  const names = new Map<string, number>();
  for (const f of findings) if (f.remote && !lookup.has(f.componentKey)) names.set(f.name, (names.get(f.name) ?? 0) + 1);
  const chosen = product ?? guessProduct([...names].map(([name, count]) => ({ name, count })), byName) ?? indexes[0].product;
  const analog = (f: { name: string; width: number; height: number }) => {
    const m = matchByName(f.name, f, byName, chosen);
    return m.status === 'exact' || m.status === 'stretched';
  };
  const result = countAdoption(findings.map((f) => adoptionItem(f, lookup, analog, legacy)));
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pages = pageIds.map((id) => figma.root.children.find((p) => p.id === id)?.name ?? id).map((page) => ({ fileKey: figma.fileKey ?? '', page }));
  const json = adoptionJson(result, { product: chosen, date, pages, source: `Components Swapper v${__VERSION__}` });
  const legacyNames = legacyIndexes.map((i) => libraries.libraries.find((l) => l.id === i.libraryId)?.name ?? i.libraryId);
  const missingLegacy = libraries.libraries.filter((l) => l.kind === 'legacy' && !legacyIndexes.some((i) => i.libraryId === l.id)).map((l) => l.name);
  post({ type: 'measured', result, json, unreadable, inSets, products: [...new Set(indexes.map((i) => i.product))].sort(), legacy: { indexed: legacyNames, missing: missingLegacy } });
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
    else if (msg.type === 'settle') await settle(msg.overrides);
    else if (msg.type === 'focus') await focus(msg.nodeId);
    else if (msg.type === 'select') await select(msg.nodeIds);
    else if (msg.type === 'propose') await proposeDrafts(msg.ids);
    else if (msg.type === 'open-library') figma.openExternal(msg.url);
    else if (msg.type === 'measure') await measure(msg.pageIds, msg.product);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
