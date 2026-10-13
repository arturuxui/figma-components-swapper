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

/** Реальные расхождения экземпляра с его компонентом. */
export async function realOverrides(inst: InstanceNode): Promise<OverrideDiff[]> {
  const relevant = inst.overrides.filter((o) => o.overriddenFields.some((f) => f in FIELDS));
  if (!relevant.length) return [];
  const main = await mainOf(inst);
  if (!main) return [];
  const out: OverrideDiff[] = [];
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
      if (from !== to) out.push({ layer: node.id === inst.id ? 'компонент' : node.name, field, from, to });
    }
  }
  return out;
}
