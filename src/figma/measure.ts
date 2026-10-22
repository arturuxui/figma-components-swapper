// Замер внедрения AID (AID-LU-19): обход выбранных страниц, экземпляры верхнего уровня — правила §2 методики
// (src/core/adoption.ts). Только чтение.

import type { AdoptionFinding } from '../core/adoption';

export interface MeasureScan {
  findings: AdoptionFinding[];
  /** Экземпляры, у которых не прочитался главный компонент (удалён, недоступен). */
  unreadable: number;
  /**
   * Из них внутри наборов компонентов на странице. Считаются как все (экраны в макетах бывают компонентами);
   * отдельно — для сверки с аудитом AID-LU-13, который в наборы не заходил.
   */
  inSets: number;
}

/** Внутрь экземпляров не спускаемся: вложенное — часть родителя (§2 «только верхний уровень»). */
export async function measurePages(pageIds: readonly string[], progress: (text: string) => void): Promise<MeasureScan> {
  const out: MeasureScan = { findings: [], unreadable: 0, inSets: 0 };
  let seen = 0;
  // `inSet` — внутри набора компонентов. Определения компонентов на странице обходятся как фреймы: на «Order»
  // экраны — компоненты 360×720, без них пропала бы половина макета.
  const visit = async (node: SceneNode, hidden: boolean, inSet: boolean, page: string): Promise<void> => {
    if (++seen % 500 === 0) progress(`Замер «${page}»: просмотрено слоёв ${seen}`);
    const isHidden = hidden || !node.visible;
    if (node.type === 'INSTANCE') {
      const main = await node.getMainComponentAsync().catch(() => null);
      if (!main) {
        out.unreadable++;
        return;
      }
      if (inSet) out.inSets++;
      const set = main.parent?.type === 'COMPONENT_SET' ? main.parent : null;
      out.findings.push({ componentKey: main.key, setKey: set?.key, name: set?.name ?? main.name, remote: main.remote, width: node.width, height: node.height, hidden: isHidden });
      return;
    }
    if ('children' in node) for (const child of node.children) await visit(child, isHidden, inSet || node.type === 'COMPONENT_SET', page);
  };
  for (const id of pageIds) {
    const page = await figma.getNodeByIdAsync(id);
    if (!page || page.type !== 'PAGE') continue;
    await page.loadAsync();
    for (const child of page.children) await visit(child, false, false, page.name);
  }
  return out;
}

