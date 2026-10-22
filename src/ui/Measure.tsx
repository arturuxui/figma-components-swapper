// Замер внедрения AID (AID-LU-19): выбор страниц, итог по методике PD и JSON точки замера.

import { useState } from 'preact/hooks';
import type { AdoptionCounts } from '../core/adoption';
import type { PageRef, ToUi } from '../shared/messages';

export type Measured = Extract<ToUi, { type: 'measured' }>;

const SOURCES: { key: keyof AdoptionCounts; label: string }[] = [
  { key: 'aid', label: 'AID' },
  { key: 'legacy', label: 'Старая' },
  { key: 'local', label: 'Локальные' },
  { key: 'other', label: 'Другие' },
];

const sum = (c: AdoptionCounts) => c.aid + c.legacy + c.local + c.other;
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %` : '—');

export function Measure({
  pages,
  currentPageId,
  measured,
  busy,
  onMeasure,
}: {
  pages: PageRef[];
  currentPageId: string;
  measured: Measured | null;
  busy: boolean;
  onMeasure: (pageIds: string[], product?: string) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([currentPageId]);
  const [product, setProduct] = useState('');
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <section class="card">
      <h2>Замер внедрения AID</h2>
      <p class="muted">Экземпляры верхнего уровня на выбранных страницах — по методике PD (черновик 0.1.0). Макет не меняется.</p>
      <ul class="rows pages">
        {pages.map((p) => (
          <li key={p.id}>
            <label class="line grow">
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} />
              <span class="name">{p.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div class="line">
        <label class="line grow">
          Продукт
          <select value={product} onChange={(e) => setProduct((e.target as HTMLSelectElement).value)}>
            <option value="">угадать</option>
            {(measured?.products ?? ['driver', 'rider']).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button class="primary" disabled={busy || !chosen.length} onClick={() => onMeasure(chosen, product || undefined)}>
          Замерить
        </button>
      </div>
      {measured && <MeasureResult measured={measured} />}
    </section>
  );
}

function MeasureResult({ measured }: { measured: Measured }) {
  const { result: r, json } = measured;
  const all = sum(r.components);
  const text = JSON.stringify(json, null, 2);
  const auditTotal = sum(r.components) + sum(r.icons) + sum(r.hidden.components) + sum(r.hidden.icons);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `${json.date}.json`;
    a.click();
  };
  const copy = (e: Event) => {
    const area = (e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector('textarea');
    area?.select();
    document.execCommand('copy');
  };
  return (
    <div class="measure">
      <p>
        Продукт <b>{json.product}</b> · внедрение AID: <b>{pct(r.components.aid, all)}</b> компонентов, {pct(r.icons.aid, sum(r.icons))} иконок
      </p>
      <table>
        <thead>
          <tr>
            <th />
            {SOURCES.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Компоненты', r.components],
              ['Иконки', r.icons],
              ['Скрытые компоненты', r.hidden.components],
              ['Скрытые иконки', r.hidden.icons],
            ] as const
          ).map(([label, c]) => (
            <tr key={label} class={label.startsWith('Скрытые') ? 'muted' : ''}>
              <td>{label}</td>
              {SOURCES.map((s) => (
                <td key={s.key}>{c[s.key]}</td>
              ))}
              <td>{sum(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Готово к замене: {r.legacyWithAidAnalog} из {r.components.legacy} старых ({pct(r.legacyWithAidAnalog, r.components.legacy)}) · уникальных:{' '}
        {r.unique.withAnalog} из {r.unique.legacy}
      </p>
      <p class="muted">
        Как в аудите (со скрытыми и иконками): {auditTotal} экземпляров{measured.unreadable ? ` · не прочитано: ${measured.unreadable}` : ''}
        {measured.inSets ? ` · из них внутри наборов компонентов: ${measured.inSets}` : ''}. Скрытые в
        JSON не входят; «Другие» — 0: плагин не различает внешние библиотеки, всё внешнее не из AID — «Старая».
      </p>
      <textarea readOnly rows={8} value={text} />
      <div class="line">
        <button onClick={download}>Скачать JSON</button>
        <button onClick={copy}>Копировать</button>
      </div>
    </div>
  );
}
