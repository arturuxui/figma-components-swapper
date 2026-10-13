// Реальные расхождения экземпляра со своим компонентом (src/core/overrides.ts): только чтение.
//
// `instance.overrides` помечает поле и тогда, когда значение совпадает с компонентом (опыт 2026-10-13: из семи
// «частых переопределений» на «Port queue» реальных оказалось три). Поэтому каждое помеченное поле сравниваем со
// значением того же слоя в главном компоненте — слой ищем по пути индексов детей. Внутри вложенного экземпляра,
// которому заменили компонент (другая иконка), сравнивать не с чем — это обычная замена содержимого, пропускаем.

import type { OverrideDiff, OverrideField } from '../core/overrides';

const FIELDS: Record<string, OverrideField> = {
  fills: 'fill',
  fillStyleId: 'fill',
  strokes: 'stroke',
  strokeStyleId: 'stroke',
  textStyleId: 'textStyle',
  fontName: 'textStyle',
  fontSize: 'textStyle',
  visible: 'visible',
  opacity: 'opacity',
  cornerRadius: 'radius',
  topLeftRadius: 'radius',
  topRightRadius: 'radius',
  bottomLeftRadius: 'radius',
  bottomRightRadius: 'radius',
  effects: 'effect',
  effectStyleId: 'effect',
};

const styleNames = new Map<string, Promise<string>>();
function styleName(id: unknown): Promise<string> {
  if (typeof id !== 'string') return Promise.resolve('смешанный');
  if (!id) return Promise.resolve('');
  let p = styleNames.get(id);
  if (!p) {
    p = figma
      .getStyleByIdAsync(id)
      .then((s) => s?.name ?? 'стиль')
      .catch(() => 'стиль');
    styleNames.set(id, p);
  }
  return p;
}

const hex = (c: RGB) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

async function paints(list: unknown): Promise<string> {
  if (typeof list === 'symbol') return 'смешанный';
  const shown = (Array.isArray(list) ? (list as Paint[]) : []).filter((p) => p.visible !== false);
  if (!shown.length) return 'нет';
  const out: string[] = [];
  for (const p of shown) {
    if (p.type !== 'SOLID') out.push(p.type === 'IMAGE' ? 'картинка' : 'градиент');
    else if (p.boundVariables?.color) {
      const v = await figma.variables.getVariableByIdAsync(p.boundVariables.color.id).catch(() => null);
      out.push(v?.name ?? 'переменная');
    } else out.push(hex(p.color) + (p.opacity !== undefined && p.opacity < 1 ? ` ${Math.round(p.opacity * 100)} %` : ''));
  }
  return out.join(' + ');
}

/** Значение поля слоя по-человечески: стиль, если есть, иначе сами цвета; у текста — шрифт и стиль по кускам. */
async function value(node: SceneNode, field: OverrideField): Promise<string> {
  const n = node as SceneNode & Record<string, unknown>;
  switch (field) {
    case 'fill':
    case 'textColor':
      return (await styleName(n.fillStyleId)) || paints(n.fills);
    case 'stroke':
      return (await styleName(n.strokeStyleId)) || paints(n.strokes);
    case 'effect':
      return (await styleName(n.effectStyleId)) || (Array.isArray(n.effects) && n.effects.some((e: Effect) => e.visible) ? 'есть' : 'нет');
    case 'textStyle': {
      if (node.type !== 'TEXT') return '';
      const parts = new Set<string>();
      for (const s of node.getStyledTextSegments(['fontName', 'fontSize', 'textStyleId'])) {
        const style = await styleName(s.textStyleId);
        parts.add(style || `${s.fontName.family} ${s.fontName.style} ${s.fontSize}`);
      }
      return [...parts].join(' + ');
    }
    case 'visible':
      return node.visible ? 'виден' : 'скрыт';
    case 'opacity':
      return `${Math.round(Number(n.opacity) * 100)} %`;
    case 'radius':
      return typeof n.cornerRadius === 'number' ? String(n.cornerRadius) : [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].join('/');
  }
}

/** Путь индексов от корня экземпляра до слоя (по id: обёртки узлов в API не равны по ссылке). */
function pathOf(node: BaseNode, root: BaseNode): number[] | null {
  const path: number[] = [];
  for (let n: BaseNode | null = node; n && n.id !== root.id; n = n.parent) {
    const parent = n.parent;
    if (!parent || !('children' in parent)) return null;
    path.unshift(parent.children.findIndex((c) => c.id === n!.id));
  }
  return path;
}

function at(root: SceneNode, path: number[]): SceneNode | null {
  let n: SceneNode | null = root;
  for (const i of path) n = n && 'children' in n ? (n.children[i] ?? null) : null;
  return n;
}

const mainOf = (n: InstanceNode) => n.getMainComponentAsync().catch(() => null);

/** Слой внутри вложенного экземпляра, которому заменили компонент: сравнивать с главным не с чем. */
async function insideSwapped(node: SceneNode, inst: InstanceNode, main: ComponentNode): Promise<boolean> {
  for (let n = node.parent; n && n.id !== inst.id; n = n.parent) {
    if (n.type !== 'INSTANCE') continue;
    const path = pathOf(n, inst);
    const ref = path && at(main, path);
    if (!ref || ref.type !== 'INSTANCE') return true;
    if ((await mainOf(n))?.id !== (await mainOf(ref))?.id) return true;
  }
  return false;
}

interface FoundOverride {
  node: SceneNode;
  field: OverrideField;
  diff: OverrideDiff;
}

/** Реальные расхождения со слоями, на которых они найдены. */
async function findOverrides(inst: InstanceNode): Promise<FoundOverride[]> {
  const relevant = inst.overrides.filter((o) => o.overriddenFields.some((f) => f in FIELDS));
  if (!relevant.length) return [];
  const main = await mainOf(inst);
  if (!main) return [];
  const out: FoundOverride[] = [];
  const seen = new Set<string>();
  for (const o of relevant) {
    const node = o.id === inst.id ? inst : (inst.findOne((n) => n.id === o.id) as SceneNode | null);
    if (!node) continue;
    const path = pathOf(node, inst);
    const ref = path && at(main, path);
    // Корень экземпляра сравнивается с самим компонентом (INSTANCE против COMPONENT), остальные — слой того же типа.
    if (!ref || (node.id !== inst.id && ref.type !== node.type) || (await insideSwapped(node, inst, main))) continue;
    for (const f of o.overriddenFields) {
      let field = FIELDS[f];
      if (!field) continue;
      if (field === 'fill' && node.type === 'TEXT') field = 'textColor';
      const key = `${node.id}|${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [from, to] = await Promise.all([value(ref, field), value(node, field)]);
      if (from !== to) out.push({ node, field, diff: { layer: node.id === inst.id ? 'компонент' : node.name, field, from, to } });
    }
  }
  return out;
}

/** Реальные расхождения экземпляра с его компонентом. */
export async function realOverrides(inst: InstanceNode): Promise<OverrideDiff[]> {
  return (await findOverrides(inst)).map((f) => f.diff);
}

// --- Применение выбора при замене (этап 5, шаг 2) ---

/** Сырые значения поля слоя — чтобы повторить их на другом слое или вернуть при отмене. */
type FieldValues = Record<string, unknown>;

const KEYS: Record<OverrideField, string[]> = {
  fill: ['fillStyleId', 'fills'],
  textColor: ['fillStyleId', 'fills'],
  stroke: ['strokeStyleId', 'strokes'],
  effect: ['effectStyleId', 'effects'],
  textStyle: ['textStyleId', 'fontName', 'fontSize'],
  visible: ['visible'],
  opacity: ['opacity'],
  radius: ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'],
};

function read(node: SceneNode, field: OverrideField): FieldValues {
  const n = node as unknown as Record<string, unknown>;
  const out: FieldValues = {};
  for (const k of KEYS[field]) if (k in n) out[k] = n[k];
  return out;
}

const mixed = (v: unknown) => typeof v === 'symbol';

async function loadFonts(node: SceneNode) {
  if (node.type !== 'TEXT' || !node.characters.length) return;
  await Promise.all(node.getRangeAllFontNames(0, node.characters.length).map((f) => figma.loadFontAsync(f)));
}

/** Записать значения поля в слой. Смешанные значения (разные куски текста) не переносим — false. */
async function write(node: SceneNode, field: OverrideField, v: FieldValues): Promise<boolean> {
  const n = node as unknown as Record<string, unknown>;
  await loadFonts(node);
  const style = (key: string) => (typeof v[key] === 'string' && v[key] ? (v[key] as string) : '');
  switch (field) {
    case 'fill':
    case 'textColor':
      if (style('fillStyleId')) await (node as unknown as MinimalFillsMixin).setFillStyleIdAsync(style('fillStyleId'));
      else if (mixed(v.fills)) return false;
      else n.fills = v.fills;
      return true;
    case 'stroke':
      if (style('strokeStyleId')) await (node as unknown as MinimalStrokesMixin).setStrokeStyleIdAsync(style('strokeStyleId'));
      else n.strokes = v.strokes;
      return true;
    case 'effect':
      if (style('effectStyleId')) await (node as unknown as BlendMixin).setEffectStyleIdAsync(style('effectStyleId'));
      else n.effects = v.effects;
      return true;
    case 'textStyle': {
      if (node.type !== 'TEXT') return false;
      if (style('textStyleId')) {
        await node.setTextStyleIdAsync(style('textStyleId'));
        return true;
      }
      if (mixed(v.fontName) || mixed(v.fontSize)) return false;
      await figma.loadFontAsync(v.fontName as FontName);
      node.fontName = v.fontName as FontName;
      node.fontSize = v.fontSize as number;
      return true;
    }
    case 'visible':
      node.visible = Boolean(v.visible);
      return true;
    case 'opacity':
      n.opacity = v.opacity;
      return true;
    case 'radius':
      if (!mixed(v.cornerRadius)) n.cornerRadius = v.cornerRadius;
      else for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) n[k] = v[k];
      return true;
  }
}

/** Расхождение, запомненное до замены: где было (путь и как найти слой в новом компоненте) и какие значения. */
export interface CapturedOverride {
  diff: OverrideDiff;
  field: OverrideField;
  root: boolean;
  /** Путь в старом экземпляре — для отмены. */
  path: number[];
  name: string;
  type: NodeType;
  /** Номер среди слоёв того же типа и среди слоёв того же типа и имени (обход в глубину). */
  ordinal: number;
  sameName: number;
  values: FieldValues;
}

const layers = (inst: InstanceNode, type: NodeType) => inst.findAll((n) => n.type === type) as SceneNode[];
const bare = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

/** Запомнить реальные расхождения экземпляра перед заменой. */
export async function captureOverrides(inst: InstanceNode): Promise<CapturedOverride[]> {
  const out: CapturedOverride[] = [];
  for (const { node, field, diff } of await findOverrides(inst)) {
    const root = node.id === inst.id;
    const same = root ? [] : layers(inst, node.type);
    out.push({
      diff,
      field,
      root,
      path: root ? [] : (pathOf(node, inst) ?? []),
      name: node.name,
      type: node.type,
      ordinal: same.findIndex((n) => n.id === node.id),
      sameName: same.filter((n) => bare(n.name) === bare(node.name)).findIndex((n) => n.id === node.id),
      values: read(node, field),
    });
  }
  return out;
}

/** Слой нового (нашего) экземпляра для расхождения: корень, слой с тем же именем или тот же по счёту того же типа. */
function locate(inst: InstanceNode, c: CapturedOverride): SceneNode | null {
  if (c.root) return inst;
  const same = layers(inst, c.type);
  const named = same.filter((n) => bare(n.name) === bare(c.name));
  if (named.length) return named[Math.min(Math.max(c.sameName, 0), named.length - 1)];
  return same[c.ordinal] ?? null;
}

/**
 * После замены: `keep` — повторить значение из старого экземпляра на нашем, `reset` — вернуть слою значение нашего
 * компонента (если замена перенесла переопределение). false — слой не нашёлся или значение не переносится.
 */
export async function applyOverride(inst: InstanceNode, c: CapturedOverride, mode: 'keep' | 'reset'): Promise<boolean> {
  const target = locate(inst, c);
  if (!target) return false;
  if (mode === 'keep') return write(target, c.field, c.values);
  const main = await mainOf(inst);
  const path = target.id === inst.id ? [] : pathOf(target, inst);
  const ref = main && path ? at(main, path) : null;
  if (!ref) return false;
  return write(target, c.field, read(ref, c.field));
}

/** Отмена: после возврата старого компонента вернуть слоям запомненные значения. */
export async function restoreOverrides(inst: InstanceNode, captured: readonly CapturedOverride[]): Promise<void> {
  for (const c of captured) {
    const node = c.root ? inst : at(inst, c.path);
    if (!node) continue;
    try {
      await write(node, c.field, c.values);
    } catch {
      // слой не принимает значение — останется как в компоненте
    }
  }
}
