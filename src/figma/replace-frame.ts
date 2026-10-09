// Замена фрейма (отвязанного или ручного) экземпляром нашего компонента — этап 2, Шаг 05b скилла.
// Вариант набора — по устройству фрейма (core/structure.ts), экземпляр встаёт на место фрейма с тем же поведением
// в раскладке, тексты и иконки фрейма переносятся. Сам фрейм не удаляется, а скрывается: «Отменить» его вернёт;
// окончательно он удаляется при следующем скане, применении или закрытии плагина (`finalizeFrames`).

import { matchByName, type Candidate } from '../core/match';
import { mapIcons, mapTexts, pickByStructure, signature, type Signature } from '../core/structure';
import { snapshot } from './structure';
import { importTarget } from './swap';

/** Метка скрытого исходного фрейма: значение — id экземпляра, который его заменил. */
export const REPLACED_MARK = 'cs-replaced';

export interface FrameOutcome {
  instance: InstanceNode;
  /** Тексты фрейма, которым не нашлось места в компоненте. */
  lost: string[];
  /** Тексты компонента, которые остались как в библиотеке (во фрейме для них текста не было). */
  placeholders: string[];
  /** Иконки фрейма, которых нет у нас по имени, — остались иконки компонента. */
  iconsMissing: string[];
  /** Похожесть устройства фрейма и выбранного варианта, 0..1. */
  score: number;
}

export interface FrameContext {
  byName: ReadonlyMap<string, Candidate[]>;
  product?: string;
}

const signatures = new Map<string, Promise<Signature>>();
const variantSignature = (c: ComponentNode) => {
  let p = signatures.get(c.id);
  if (!p) {
    p = snapshot(c).then(signature);
    signatures.set(c.id, p);
  }
  return p;
};

async function setText(id: string, text: string) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'TEXT' || node.characters === text) return;
  const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName as FontName];
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  node.characters = text;
}

/** Экземпляр на месте фрейма: тот же индекс у родителя, то же поведение в auto layout или те же координаты. */
function place(instance: InstanceNode, frame: FrameNode) {
  const parent = frame.parent as (BaseNode & ChildrenMixin) | null;
  if (!parent) throw new Error('У фрейма нет родителя.');
  parent.insertChild(parent.children.indexOf(frame), instance);
  const inAutoLayout = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  if (inAutoLayout && frame.layoutPositioning !== 'ABSOLUTE') {
    for (const axis of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const) {
      try {
        if (frame[axis] === 'FIXED') {
          if (axis === 'layoutSizingHorizontal') instance.resize(frame.width, instance.height);
        } else instance[axis] = frame[axis];
      } catch {
        // значение не подходит экземпляру (HUG у компонента без auto layout) — остаётся как в компоненте
      }
    }
    return;
  }
  if (inAutoLayout) instance.layoutPositioning = 'ABSOLUTE';
  instance.x = frame.x;
  instance.y = frame.y;
  instance.constraints = frame.constraints;
  // Растянутый по ширине (та же высота) — растягиваем и экземпляр; размер в остальном — как в компоненте.
  if (Math.abs(frame.width - instance.width) > 1 && Math.abs(frame.height - instance.height) <= 1) instance.resize(frame.width, instance.height);
}

export async function replaceFrame(frame: FrameNode, target: Pick<Candidate, 'key' | 'isSet'>, ctx: FrameContext): Promise<FrameOutcome> {
  const main = await importTarget(target);
  const variants = main.type === 'COMPONENT_SET' ? main.children.filter((c): c is ComponentNode => c.type === 'COMPONENT') : [main];
  const frameSig = signature(await snapshot(frame));
  const pick = pickByStructure(frameSig, await Promise.all(variants.map(variantSignature)));
  const component = variants[pick.index] ?? (main.type === 'COMPONENT_SET' ? main.defaultVariant : main);

  const instance = component.createInstance();
  place(instance, frame);

  const instSig = signature(await snapshot(instance));
  const { texts, lost } = mapTexts(frameSig.texts, instSig.texts);
  const placeholders: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const slot = instSig.texts[i];
    if (texts[i] === null) placeholders.push(slot.text);
    else if (slot.id) await setText(slot.id, texts[i] as string);
  }

  const iconsMissing: string[] = [];
  const icons = mapIcons(frameSig.icons, instSig.icons);
  for (let i = 0; i < icons.length; i++) {
    const name = icons[i];
    const id = instSig.iconIds[i];
    if (!name || !id) continue;
    const match = matchByName(name, { width: 24, height: 24 }, ctx.byName, ctx.product);
    const node = await figma.getNodeByIdAsync(id);
    if (match.status !== 'exact' || !match.target || !node || node.type !== 'INSTANCE') {
      iconsMissing.push(name);
      continue;
    }
    const icon = await importTarget(match.target);
    node.swapComponent(icon.type === 'COMPONENT_SET' ? icon.defaultVariant : icon);
  }

  frame.visible = false;
  try {
    frame.setPluginData(REPLACED_MARK, instance.id);
  } catch {
    // без метки: скан всё равно пропускает скрытые фреймы, заменённые в этом запуске (журнал)
  }
  return { instance, lost, placeholders, iconsMissing, score: pick.score };
}
