// Отчёт скана с подбором по имени: что заменить, на что, примерка «Было / Будет».

import { resolveChoice, type Candidate, type MatchStatus } from '../core/match';
import type { Origin, ReportGroup } from '../core/scan-report';
import type { VariantPick } from '../core/variants';
import type { Matches, TargetRef, ToUi } from '../shared/messages';
import { send, type Scanned } from './bridge';

/** id группы → ключ нашего компонента или '' (пропустить). */
export type Decisions = Record<string, string>;

export interface Preview {
  targetKey: string;
  before: string;
  after: string;
  pick: VariantPick | null;
  lost: string[];
  sizeChanged: boolean;
  placeholders?: string[];
  iconsMissing?: string[];
  score?: number;
}

type Matched = Extract<ToUi, { type: 'matched' }>;

const ORIGIN_LABEL: Record<Origin, string> = { foreign: 'Чужой', local: 'Локальный', ours: 'Наш' };
const STATUS: Record<MatchStatus, { label: string; cls: string; hint: string }> = {
  exact: { label: 'Пара', cls: 'ours', hint: 'Наш компонент с тем же именем и подходящим размером' },
  stretched: { label: 'Растянут', cls: 'ours', hint: 'Тот же компонент, растянутый по ширине: высота совпала, компонент горизонтальный. Проверьте примеркой' },
  size: { label: 'Другой размер', cls: 'foreign', hint: 'Имя совпало, размер отличается больше чем на 20 % — проверьте назначение примеркой' },
  ambiguous: { label: 'Выбрать', cls: 'foreign', hint: 'Несколько наших компонентов с этим именем — выберите нужный' },
  none: { label: 'Нет пары', cls: 'local', hint: 'Нет нашего компонента с таким именем (этапы 2–3)' },
  named: { label: 'Имя и устройство', cls: 'foreign', hint: 'Ручной фрейм: имя как у нашего компонента, устройство похоже — посмотрите примерку' },
  similar: { label: 'Похож по устройству', cls: 'foreign', hint: 'Ручной фрейм со своим оформлением, устроен почти как наш компонент — посмотрите примерку' },
};
const PRODUCT_LABEL: Record<string, string> = { driver: 'Driver', rider: 'Rider' };

const candidateLabel = (c: Candidate) => `${c.name.trim()}${c.isSet ? ` · ${c.sizes.length} вар.` : ''} · ${c.kind === 'icons' ? 'иконка' : 'компонент'}`;

interface Props {
  scanned: Scanned;
  matched: Matched | null;
  decisions: Decisions;
  previews: Record<string, Preview>;
  busy: boolean;
  onDecide: (groupId: string, key: string) => void;
  onProduct: (product: string) => void;
  onPreview: (groupId: string, target: TargetRef) => void;
}

export function Report({ scanned, matched, decisions, previews, busy, onDecide, onProduct, onPreview }: Props) {
  const { report, scopeName, unreadable } = scanned;
  const t = report.totals;
  const toReplace = report.groups.filter((g) => !g.detached && !g.manual && g.origin !== 'ours');
  const detached = report.groups.filter((g) => g.detached);
  const manual = report.groups.filter((g) => g.manual);
  const matches: Matches = matched?.matches ?? {};
  const chosen = [...toReplace, ...detached, ...manual].filter((g) => decisions[g.id]);
  const places = chosen.reduce((n, g) => n + g.count, 0);
  const allPlaces = [...toReplace, ...detached, ...manual].reduce((n, g) => n + g.count, 0);

  return (
    <>
      <p class="muted">Область: {scopeName}</p>
      <div class="totals">
        <Total n={t.foreign} label="чужих" />
        <Total n={t.local} label="локальных" />
        <Total n={t.ours} label="наших" />
      </div>
      <p class="muted">
        Отвязаны от наших компонентов: {t.detachedOurs}, от других: {t.detachedOther}
        {unreadable ? ` · не прочитано экземпляров: ${unreadable}` : ''}
      </p>

      {matched && matched.products.length > 1 && (
        <label class="row">
          <span>Продукт макета</span>
          <select value={matched.product ?? ''} disabled={busy} onChange={(e) => onProduct((e.target as HTMLSelectElement).value)}>
            {matched.products.map((p) => (
              <option key={p} value={p}>
                {PRODUCT_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </label>
      )}

      {toReplace.length > 0 && (
        <section>
          <h2>
            Заменить · выбрано {places} из {allPlaces} мест
          </h2>
          <p class="muted">Экземпляры чужих и локальных компонентов</p>
          <ul class="rows">
            {toReplace.map((g) => (
              <Row
                key={g.id}
                group={g}
                match={matches[g.id]}
                value={decisions[g.id] ?? ''}
                preview={previews[g.id]}
                busy={busy}
                onDecide={(key) => onDecide(g.id, key)}
                onPreview={(target) => onPreview(g.id, target)}
              />
            ))}
          </ul>
          <p class="muted">«Заменить» меняет только строки с выбранным компонентом; примерка делается на временной копии и макет не меняет.</p>
        </section>
      )}
      {detached.length > 0 && (
        <section>
          <h2>Отвязанные фреймы → экземпляры наших компонентов</h2>
          <p class="muted">
            Вариант выбирается по устройству фрейма, тексты и иконки переносятся. Кроме отвязанных от наших, ничего не выбрано сразу —
            посмотрите примерку.
          </p>
          <ul class="rows">
            {detached.map((g) => (
              <Row
                key={g.id}
                group={g}
                match={matches[g.id]}
                value={decisions[g.id] ?? ''}
                preview={previews[g.id]}
                busy={busy}
                onDecide={(key) => onDecide(g.id, key)}
                onPreview={(target) => onPreview(g.id, target)}
              />
            ))}
          </ul>
        </section>
      )}
      {manual.length > 0 && (
        <section>
          <h2>Ручные фреймы, похожие на наши компоненты</h2>
          <p class="muted">Не компоненты и не отвязанные, но устроены как наши. Ничего не выбрано сразу — посмотрите примерку и решите.</p>
          <ul class="rows">
            {manual.map((g) => (
              <Row
                key={g.id}
                group={g}
                match={matches[g.id]}
                value={decisions[g.id] ?? ''}
                preview={previews[g.id]}
                busy={busy}
                onDecide={(key) => onDecide(g.id, key)}
                onPreview={(target) => onPreview(g.id, target)}
              />
            ))}
          </ul>
        </section>
      )}
      {!toReplace.length && !detached.length && !manual.length && <p>Всё из библиотек WB AID.</p>}
    </>
  );
}

const Total = ({ n, label }: { n: number; label: string }) => (
  <div class="card">
    <div class="num">{n}</div>
    <div class="muted">{label}</div>
  </div>
);

interface RowProps {
  group: ReportGroup;
  match: Matched['matches'][string] | undefined;
  value: string;
  preview: Preview | undefined;
  busy: boolean;
  onDecide: (key: string) => void;
  onPreview: (target: TargetRef) => void;
}

function Row({ group: g, match, value, preview, busy, onDecide, onPreview }: RowProps) {
  const status = match ? STATUS[match.status] : null;
  const choice = match && value ? resolveChoice(match.alternatives, value) : null;
  const owner = choice?.owner;
  const shown = preview && choice && preview.targetKey === choice.target.key ? preview : null;
  // Отвязанный фрейм: вариант набора дизайнер может выбрать сам — смысл варианта (цвет, «повышена/понижена»)
  // по устройству фрейма не виден.
  const variants = (g.detached || g.manual) && owner?.isSet && owner.variants && owner.variants.length > 1 ? owner.variants : null;
  return (
    <li class="group">
      <div class="line">
        <span class={`tag ${g.origin}`}>{g.manual ? 'Ручной' : g.detached ? `Отвязан${g.origin === 'ours' ? ' от нашего' : ''}` : ORIGIN_LABEL[g.origin]}</span>
        <span class="name" title={g.name}>
          {g.name}
        </span>
        <span class="muted">
          ×{g.count} · экр. {g.screens}
        </span>
        <button class="link" title={g.exampleScreen} onClick={() => send({ type: 'focus', nodeId: g.exampleNodeId })}>
          Показать
        </button>
      </div>
      {match && status && (
        <div class="line">
          <span class={`tag ${status.cls}`} title={status.hint}>
            {status.label}
            {match.score !== undefined ? ` · ${Math.round(match.score * 100)} %` : ''}
          </span>
          {match.alternatives.length ? (
            <select class="grow" value={owner?.key ?? ''} disabled={busy} onChange={(e) => onDecide((e.target as HTMLSelectElement).value)}>
              <option value="">— не заменять —</option>
              {match.alternatives.map((c) => (
                <option key={c.key} value={c.key}>
                  → {candidateLabel(c)}
                </option>
              ))}
            </select>
          ) : (
            <span class="muted grow">{status.hint}</span>
          )}
          {choice && (
            <button class="link" disabled={busy} onClick={() => onPreview(choice.target)}>
              Примерка
            </button>
          )}
        </div>
      )}
      {variants && owner && (
        <div class="line">
          <span class="muted">Вариант</span>
          <select class="grow" value={value === owner.key ? '' : value} disabled={busy} onChange={(e) => onDecide((e.target as HTMLSelectElement).value || owner.key)}>
            <option value="">авто — по устройству фрейма</option>
            {variants.map((v) => (
              <option key={v.key} value={v.key}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {shown && (
        <div class="preview">
          <figure>
            <img src={shown.before} alt="" />
            <figcaption>Было</figcaption>
          </figure>
          <figure>
            <img src={shown.after} alt="" />
            <figcaption>Будет</figcaption>
          </figure>
          <PreviewNotes preview={shown} />
        </div>
      )}
    </li>
  );
}

function PreviewNotes({ preview: p }: { preview: Preview }) {
  const notes: string[] = [];
  if (p.lost.length) notes.push(`Пропадут тексты: ${p.lost.map((s) => `«${s}»`).join(', ')}`);
  if (p.pick?.unmatched.length) notes.push(`Не нашлось в наших вариантах: ${p.pick.unmatched.join(', ')} — будет вариант по умолчанию по этим осям`);
  if (p.sizeChanged) notes.push('Размер изменится');
  if (p.placeholders?.length) notes.push(`Останутся тексты компонента: ${p.placeholders.map((s) => `«${s}»`).join(', ')}`);
  if (p.iconsMissing?.length) notes.push(`Иконок нет у нас: ${p.iconsMissing.join(', ')} — останутся иконки компонента`);
  if (p.score !== undefined && p.score < 0.8) notes.push(`Устройство похоже на ${Math.round(p.score * 100)} % — проверьте`);
  return <p class={notes.length ? 'error notes' : 'muted notes'}>{notes.length ? notes.join(' · ') : 'Тексты и размер сохраняются'}</p>;
}
