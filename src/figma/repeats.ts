// Повторы (этап 4): снимок устройства каждого экрана для core/repeats.ts. Только чтение.

import type { ScreenRef } from '../core/scan-report';
import type { StructNode } from '../core/structure';
import { SCREEN_DEPTH, snapshot } from './structure';

const isScreen = (n: SceneNode) => n.type === 'FRAME' && (n.parent?.type === 'PAGE' || n.parent?.type === 'SECTION');

/** Экраны в области скана: фреймы верхнего уровня страницы и секций; выделенный фрагмент — сам себе экран. */
function screensOf(roots: readonly SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (n: SceneNode) => {
    if (!n.visible) return;
    if (n.type === 'SECTION') n.children.forEach(visit);
    else if (isScreen(n) || n.type === 'FRAME') out.push(n);
  };
  for (const r of roots) visit(r);
  return out;
}

export async function screenTrees(roots: readonly SceneNode[], progress: (text: string) => void): Promise<{ ref: ScreenRef; tree: StructNode }[]> {
  const screens = screensOf(roots);
  const out: { ref: ScreenRef; tree: StructNode }[] = [];
  for (let i = 0; i < screens.length; i++) {
    if (i % 10 === 0) progress(`Повторы: экран ${i + 1} из ${screens.length}`);
    out.push({ ref: { id: screens[i].id, name: screens[i].name }, tree: await snapshot(screens[i], 0, SCREEN_DEPTH) });
  }
  return out;
}
