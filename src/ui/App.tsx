// Окно плагина. В файле библиотеки — сбор индекса, в макете — скан, подбор по имени и примерка (этап 1а–1б).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { IndexSummary } from '../core/library-index';
import { resolveChoice } from '../core/match';
import type { OverrideChoice } from '../core/overrides';
import type { ApplyResult } from '../figma/apply';
import type { LibraryInfo, Matches, PageRef, TargetRef, ToPlugin, ToUi } from '../shared/messages';
import { Applied } from './Applied';
import { send, type Scanned } from './bridge';
import { Measure, type Measured } from './Measure';
import { Report, type Decisions, type Preview } from './Report';

type Matched = Extract<ToUi, { type: 'matched' }>;
type Proposed = Extract<ToUi, { type: 'proposed' }>;

const date = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Решение по умолчанию: уверенные пары — заменить, остальное — ждёт дизайнера. */
function defaultDecisions(matches: Matches, report: Scanned['report'] | undefined): Decisions {
  const out: Decisions = {};
  const groups = new Map((report?.groups ?? []).map((g) => [g.id, g]));
  for (const [id, m] of Object.entries(matches)) {
    const g = groups.get(id);
    // Отвязанный фрейм заменяется целиком — сразу выбран только отвязанный от нашего; остальное — после примерки.
    const sure = g?.manual ? false : g?.detached ? g.origin === 'ours' : m.status === 'exact' || m.status === 'stretched' || m.status === 'drawn';
    out[id] = sure && m.target ? m.target.key : '';
  }
  return out;
}

export function App() {
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [matched, setMatched] = useState<Matched | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // Скан приходит раньше подбора, а обработчик сообщений создаётся один раз — нужен ref, а не состояние.
  const scannedRef = useRef<Scanned | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState<{ restored: number; failed: number } | null>(null);
  const [proposed, setProposed] = useState<Proposed | null>(null);
  /** Выбор по расхождениям с компонентом (этап 5): id группы расхождений → что делать при замене. */
  const [overrideChoices, setOverrideChoices] = useState<Record<string, OverrideChoice>>({});
  const [pages, setPages] = useState<{ list: PageRef[]; current: string }>({ list: [], current: '' });
  const [measured, setMeasured] = useState<Measured | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data?.pluginMessage as ToUi | undefined;
      if (!msg) return;
      if (msg.type === 'init') {
        setLibrary(msg.library);
        setLibraries(msg.libraries);
        setIndexes(msg.indexes);
        setPages({ list: msg.pages, current: msg.currentPageId });
        setReady(true);
      } else if (msg.type === 'progress') setBusy(msg.text);
      else if (msg.type === 'indexed') {
        setIndexes((all) => [...all.filter((i) => i.libraryId !== msg.summary.libraryId), msg.summary]);
        setBusy(null);
      } else if (msg.type === 'scanned') {
        scannedRef.current = msg;
        setScanned(msg);
        setPreviews({});
        setApplied(null);
        setUndone(null);
        setProposed(null);
        setOverrideChoices({});
      } else if (msg.type === 'matched') {
        setMatched(msg);
        setDecisions(defaultDecisions(msg.matches, scannedRef.current?.report));
        setBusy(null);
      } else if (msg.type === 'preview') {
        const url = (bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setPreviews((all) => ({
          ...all,
          [msg.groupId]: {
            targetKey: msg.targetKey,
            before: url(msg.before),
            after: url(msg.after),
            pick: msg.pick,
            lost: msg.lost,
            sizeChanged: msg.sizeChanged,
            placeholders: msg.placeholders,
            iconsMissing: msg.iconsMissing,
            score: msg.score,
          },
        }));
        setBusy(null);
      } else if (msg.type === 'applied') {
        setApplied(msg.result);
        setBusy(null);
      } else if (msg.type === 'proposed') {
        setProposed(msg);
        setBusy(null);
      } else if (msg.type === 'undone') {
        setUndone({ restored: msg.restored, failed: msg.failed });
        setBusy(null);
      } else if (msg.type === 'measured') {
        setMeasured(msg);
        setBusy(null);
      } else if (msg.type === 'error') {
        setError(msg.message);
        setBusy(null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const run = (msg: ToPlugin, text: string) => {
    setError(null);
    setBusy(text);
    send(msg);
  };

  if (!ready) return <main class="muted">Загрузка…</main>;

  // Выбранные пары → команда «Заменить».
  const choices: { groupId: string; target: TargetRef }[] = [];
  let places = 0;
  if (scanned && matched) {
    for (const g of scanned.report.groups) {
      const choice = decisions[g.id] ? resolveChoice(matched.matches[g.id]?.alternatives ?? [], decisions[g.id]) : null;
      if (!choice || (!g.detached && g.origin === 'ours')) continue;
      choices.push({ groupId: g.id, target: choice.target });
      places += g.count;
    }
  }
  const showReport = !library && scanned && !applied;

  return (
    <>
      <header>
        <h1>
          Components Swapper <span class="muted">v{__VERSION__}</span>
        </h1>
        <p>{library ? `Файл библиотеки: ${library.name}` : 'Макет: компоненты не из библиотек WB AID → наши'}</p>
      </header>
      <main>
        {(library || !scanned) && <Indexes libraries={libraries} indexes={indexes} current={library} />}
        {!library && !scanned && !applied && (
          <Measure
            pages={pages.list}
            currentPageId={pages.current}
            measured={measured}
            busy={!!busy}
            onMeasure={(pageIds, product) => run({ type: 'measure', pageIds, product }, 'Замеряю…')}
          />
        )}
        {!library && applied && <Applied result={applied} undone={undone} />}
        {showReport && (
          <Report
            scanned={scanned}
            matched={matched}
            decisions={decisions}
            previews={previews}
            busy={!!busy}
            onDecide={(id, key) => setDecisions((d) => ({ ...d, [id]: key }))}
            onProduct={(product) => run({ type: 'set-product', product }, 'Подбираю…')}
            onPreview={(groupId, target) => run({ type: 'preview', groupId, target }, 'Примерка…')}
            proposed={proposed}
            onPropose={(ids) => run({ type: 'propose', ids }, 'Черновики…')}
            onSettle={() => run({ type: 'settle', overrides: overrideChoices }, 'Применяю решения…')}
            overrideChoices={overrideChoices}
            onChooseOverride={(id, choice) =>
              setOverrideChoices((c) => {
                const next = { ...c };
                if (choice) next[id] = choice;
                else delete next[id];
                return next;
              })
            }
          />
        )}
        {error && <p class="error">{error}</p>}
      </main>
      <footer>
        {library ? (
          <button class="primary" disabled={!!busy} onClick={() => run({ type: 'build-index' }, 'Собираю индекс…')}>
            Собрать индекс
          </button>
        ) : (
          <>
            <button class={scanned ? '' : 'primary'} disabled={!!busy || !indexes.length} onClick={() => run({ type: 'scan' }, 'Сканирую…')}>
              {scanned ? 'Пересканировать' : 'Сканировать'}
            </button>
            {showReport && (
              <button class="primary" disabled={!!busy || !choices.length} onClick={() => run({ type: 'apply', choices, overrides: overrideChoices }, 'Заменяю…')}>
                Заменить · {places}
              </button>
            )}
            {applied && !undone && (applied.replaced > 0 || applied.nested > 0 || applied.overrides.reset > 0 || !!applied.improvements) && (
              <button disabled={!!busy} onClick={() => run({ type: 'undo' }, 'Возвращаю…')}>
                Отменить
              </button>
            )}
          </>
        )}
        <span class="muted">{busy ?? (!library && !scanned ? 'Выделение или вся страница' : '')}</span>
      </footer>
    </>
  );
}

function Indexes({ libraries, indexes, current }: { libraries: LibraryInfo[]; indexes: IndexSummary[]; current: LibraryInfo | null }) {
  return (
    <section class="card">
      <h2>Индексы библиотек</h2>
      <ul class="rows">
        {libraries.map((l) => {
          const s = indexes.find((i) => i.libraryId === l.id);
          return (
            <li key={l.id}>
              <span class="name">{l.short}</span>
              {s ? (
                <span class="muted">
                  {s.components} комп. · {s.sets} наборов · {date(s.takenAt)}
                  {l.kind === 'icons' && !s.prints && ' · без рисунков — пересоберите, чтобы подбирать по рисунку'}
                </span>
              ) : current?.id === l.id ? (
                <span class="muted">не собран</span>
              ) : (
                <button class="link" onClick={() => send({ type: 'open-library', url: l.url })}>
                  открыть и собрать
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
