// Отчёт скана с подбором по имени: что заменить, на что, примерка «Было / Будет».

import { useEffect, useState } from 'preact/hooks';
import { resolveChoice, type Candidate, type MatchStatus } from '../core/match';
import { CHOICE_LABEL, diffText, OURS_CHOICE_LABEL, type OverrideChoice, type OverrideGroup } from '../core/overrides';
import { REPEAT_MIN_PLACES, REPEAT_MIN_SCREENS, type RepeatGroup } from '../core/repeats';
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
  composite: { label: 'Составной', cls: 'foreign', hint: 'Фрейм со своим оформлением и теми же компонентами внутри, что у нашего составного компонента, — посмотрите примерку' },
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
  proposed: Extract<ToUi, { type: 'proposed' }> | null;
  onPropose: (ids: string[]) => void;
  /** Расхождения с компонентом: id группы расхождений → выбор пользователя. */
  overrideChoices: Record<string, OverrideChoice>;
  onChooseOverride: (id: string, choice: OverrideChoice | '') => void;
  /** Применить решения по расхождениям наших экземпляров (без замены). */
  onSettle: () => void;
}

export function Report({ scanned, matched, decisions, previews, busy, onDecide, onProduct, onPreview, proposed, onPropose, overrideChoices, onChooseOverride, onSettle }: Props) {
  const { report, scopeName, unreadable } = scanned;
  // Вложенные повторы и варианты не показываем отдельно: они войдут в черновик внешнего или главного.
  const repeats = scanned.repeats.filter((r) => !r.nestedIn && !r.variantOf);
  // В черновики сразу отмечены повторы без пометки «Похож на наш …».
  const defaultPicks = () => repeats.filter((r) => !r.likeOurs).map((r) => r.id);
  const [picked, setPicked] = useState<string[]>(defaultPicks);
  // Новый скан — новые повторы.
  useEffect(() => setPicked(defaultPicks()), [scanned.repeats]);
  // Расхождения с компонентом: что с ними делать, решает пользователь (по умолчанию — не решено).
  const overridesOf = (groupId: string) => scanned.overrides.filter((o) => o.groupId === groupId);
  const t = report.totals;
  const toReplace = report.groups.filter((g) => !g.detached && !g.manual && g.origin !== 'ours');
  const detached = report.groups.filter((g) => g.detached);
  const manual = report.groups.filter((g) => g.manual);
  // Наши экземпляры с расхождениями с компонентом (этап 5): замены нет, только решение по расхождению.
  const oursWithOverrides = report.groups.filter((g) => !g.detached && !g.manual && g.origin === 'ours' && overridesOf(g.id).length);
  const oursDecided = oursWithOverrides.flatMap((g) => overridesOf(g.id)).filter((o) => overrideChoices[o.id]).length;
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
                overrides={overridesOf(g.id)}
                overrideChoices={overrideChoices}
                onChooseOverride={onChooseOverride}
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
          <p class="muted">
            Не компоненты и не отвязанные, но устроены как наши — или собраны из наших компонентов, как наш составной. Ничего не выбрано сразу —
            посмотрите примерку и решите.
          </p>
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
      {oursWithOverrides.length > 0 && (
        <section>
          <h2>Наши компоненты: расхождения с компонентом · {oursWithOverrides.length}</h2>
          <p class="muted">
            Экземпляры наших компонентов, изменённые в макете одинаково. «Ошибка макета» — вернуть как в компоненте, «Перенести» — оставить, «Нужен
            вариант» — оставить и предложить доработку на странице предложений.
          </p>
          <ul class="rows">
            {oursWithOverrides.map((g) => (
              <li key={g.id} class="group">
                <div class="line">
                  <span class="tag ours">Наш</span>
                  <span class="name" title={g.name}>
                    {g.name}
                  </span>
                  <span class="muted">
                    ×{g.count} · экр. {g.screens}
                  </span>
                </div>
                <Overrides list={overridesOf(g.id)} choices={overrideChoices} busy={busy} onChoose={onChooseOverride} labels={OURS_CHOICE_LABEL} />
              </li>
            ))}
          </ul>
          <div class="line">
            <button disabled={busy || !oursDecided} onClick={onSettle}>
              Применить решения · {oursDecided}
            </button>
            <span class="muted">Отдельно от «Заменить»; «Отменить» вернёт как было.</span>
          </div>
        </section>
      )}
      {repeats.length > 0 && (
        <section>
          <h2>Повторы — кандидаты в новые компоненты · {repeats.length}</h2>
          <p class="muted">
            Фреймы одного устройства, которые не компоненты и не копии наших, — на {REPEAT_MIN_SCREENS}+ экранах или в {REPEAT_MIN_PLACES}+ местах.
            «Меняется» — тексты и иконки, которые отличаются между копиями: будущие свойства компонента. Макет не меняется.
          </p>
          <ul class="rows">
            {repeats.map((r) => (
              <RepeatRow key={r.id} repeat={r} variants={scanned.repeats.filter((v) => v.variantOf === r.id)} checked={picked.includes(r.id)} onToggle={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} />
            ))}
          </ul>
          <div class="line">
            <button disabled={busy || !picked.length} onClick={() => onPropose(picked)}>
              Черновики на страницу · {picked.length}
            </button>
            <span class="muted">Карточки с обоснованием и черновиком компонента — на странице «Components Swapper · Предложения».</span>
          </div>
          {proposed && (
            <p class="muted">
              Готово: {proposed.drafts} на странице «{proposed.pageName}».
              {proposed.missing.length ? ` Не нашлись (удалены после скана): ${proposed.missing.join(', ')}.` : ''}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function RepeatRow({ repeat: r, variants, checked, onToggle }: { repeat: RepeatGroup; variants: RepeatGroup[]; checked: boolean; onToggle: () => void }) {
  const what = [
    r.texts && `текстов ${r.texts}${r.varying.texts ? ` (меняется ${r.varying.texts})` : ''}`,
    r.icons && `иконок ${r.icons}${r.varying.icons ? ` (меняется ${r.varying.icons})` : ''}`,
    r.parts.length && `компоненты: ${[...new Set(r.parts)].join(', ')}`,
  ].filter(Boolean);
  return (
    <li class="group">
      <div class="line">
        <input type="checkbox" checked={checked} onChange={onToggle} title="В черновики" />
        <span class={`tag ${r.likeOurs ? 'ours' : 'foreign'}`} title={r.likeOurs ? `Устроен почти как наш «${r.likeOurs}» — возможно, это его копия` : undefined}>
          {r.likeOurs ? `Похож на ${r.likeOurs}` : 'Повтор'}
        </span>
        <span class="name" title={r.name}>
          {r.name}
        </span>
        <span class="muted">
          ×{r.count + variants.reduce((n, v) => n + v.count, 0)} · экр. {r.screens + variants.reduce((n, v) => n + v.screens, 0)}
        </span>
        <button class="link" title={r.exampleScreen} onClick={() => send({ type: 'focus', nodeId: r.exampleNodeId })}>
          Показать
        </button>
        <button class="link" onClick={() => send({ type: 'select', nodeIds: [r, ...variants].flatMap((v) => v.nodeIds) })}>
          Выделить все
        </button>
      </div>
      <div class="muted">
        {Math.round(r.width)}×{Math.round(r.height)} · {what.join(' · ') || 'без текстов и иконок'}
      </div>
      {variants.length > 0 && (
        <div class="muted">
          Варианты: {[r, ...variants].map((v) => `${v.variant} ×${v.count} · ${Math.round(v.width)}×${Math.round(v.height)}`).join('; ')}
        </div>
      )}
    </li>
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
  /** Расхождения экземпляров группы со своим компонентом (этап 5). */
  overrides?: OverrideGroup[];
  overrideChoices?: Record<string, OverrideChoice>;
  onChooseOverride?: (id: string, choice: OverrideChoice | '') => void;
}

function Row({ group: g, match, value, preview, busy, onDecide, onPreview, overrides, overrideChoices, onChooseOverride }: RowProps) {
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
      {overrides && overrides.length > 0 && onChooseOverride && (
        <Overrides list={overrides} choices={overrideChoices ?? {}} busy={busy} onChoose={onChooseOverride} />
      )}
    </li>
  );
}

/**
 * Расхождения экземпляров с их компонентом (правило 17 скилла): было → стало, сколько мест, пример и выбор —
 * ошибка макета, перенести или нужен вариант. Сами не решаем.
 */
function Overrides({
  list,
  choices,
  busy,
  onChoose,
  labels = CHOICE_LABEL,
}: {
  list: OverrideGroup[];
  choices: Record<string, OverrideChoice>;
  busy: boolean;
  onChoose: (id: string, choice: OverrideChoice | '') => void;
  labels?: Record<OverrideChoice, string>;
}) {
  const places = list.reduce((n, o) => n + o.count, 0);
  const open = list.filter((o) => !choices[o.id]).length;
  return (
    <details class="overrides">
      <summary>
        Расхождения с компонентом · {places} мест{open ? ` · не решено: ${open}` : ''}
      </summary>
      <ul class="rows overrides-list">
        {list.map((o) => (
          <li key={o.id}>
            {o.diffs.map((d) => (
              <div class="muted" key={diffText(d)}>
                {diffText(d)}
              </div>
            ))}
            <div class="line">
              <span class="muted">
                ×{o.count} · экр. {o.screens}
              </span>
              <button class="link" title={o.exampleScreen} onClick={() => send({ type: 'focus', nodeId: o.exampleNodeId })}>
                Показать
              </button>
              <button class="link" onClick={() => send({ type: 'select', nodeIds: o.nodeIds })}>
                Выделить все
              </button>
              <select class="grow" value={choices[o.id] ?? ''} disabled={busy} onChange={(e) => onChoose(o.id, (e.target as HTMLSelectElement).value as OverrideChoice | '')}>
                <option value="">— не решено —</option>
                {(Object.keys(labels) as OverrideChoice[]).map((c) => (
                  <option key={c} value={c}>
                    {labels[c]}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
    </details>
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
