// Примерка «Было / Будет» (правило 31 скилла): замена на временной копии экземпляра, два PNG, копия удаляется.
// Макет не меняется.

import type { Candidate } from '../core/match';
import { replaceFrame, type FrameContext } from './replace-frame';
import { swapInstance, type SwapOutcome } from './swap';

export interface PreviewResult extends SwapOutcome {
  before: Uint8Array;
  after: Uint8Array;
  /** Только для фреймов (этап 2). */
  placeholders?: string[];
  iconsMissing?: string[];
  score?: number;
}

const png = (node: SceneNode) => node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });

export async function previewSwap(nodeId: string, target: Pick<Candidate, 'key' | 'isSet'>, ctx: FrameContext): Promise<PreviewResult> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node && node.type === 'FRAME') return previewFrame(node, target, ctx);
  if (!node || node.type !== 'INSTANCE') throw new Error('Слой для примерки не найден — пересканируйте макет.');
  const copy = node.clone();
  // Копию сразу уводим из родителя на страницу, вдали от макетов: в auto layout она сдвинула бы соседей.
  figma.currentPage.appendChild(copy);
  copy.x = -100000;
  copy.y = -100000;
  try {
    const before = await png(copy);
    const outcome = await swapInstance(copy, target);
    const after = await png(copy);
    return { ...outcome, before, after };
  } finally {
    copy.remove();
  }
}

/** Фрейм: копия на странице, замена копии экземпляром (он встаёт рядом с копией), оба удаляются. */
async function previewFrame(frame: FrameNode, target: Pick<Candidate, 'key' | 'isSet'>, ctx: FrameContext): Promise<PreviewResult> {
  const copy = frame.clone();
  figma.currentPage.appendChild(copy);
  copy.x = -100000;
  copy.y = -100000;
  copy.visible = true;
  let instance: InstanceNode | null = null;
  try {
    const before = await png(copy);
    const out = await replaceFrame(copy, target, ctx);
    instance = out.instance;
    const after = await png(instance);
    return {
      before,
      after,
      pick: null,
      lost: out.lost,
      sizeChanged: Math.abs(instance.width - frame.width) > 0.5 || Math.abs(instance.height - frame.height) > 0.5,
      placeholders: out.placeholders,
      iconsMissing: out.iconsMissing,
      score: out.score,
    };
  } finally {
    if (instance && !instance.removed) instance.remove();
    copy.remove();
  }
}
