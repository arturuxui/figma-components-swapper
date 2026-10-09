// Примерка «Было / Будет» (правило 31 скилла): замена на временной копии экземпляра, два PNG, копия удаляется.
// Макет не меняется.

import type { Candidate } from '../core/match';
import { swapInstance, type SwapOutcome } from './swap';

export interface PreviewResult extends SwapOutcome {
  before: Uint8Array;
  after: Uint8Array;
}

const png = (node: SceneNode) => node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });

export async function previewSwap(nodeId: string, target: Pick<Candidate, 'key' | 'isSet'>): Promise<PreviewResult> {
  const node = await figma.getNodeByIdAsync(nodeId);
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
