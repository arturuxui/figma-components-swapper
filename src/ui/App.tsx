// Окно плагина. В файле библиотеки — сбор индекса, в макете — скан, подбор по имени и примерка (этап 1а–1б).

import { useEffect, useState } from 'preact/hooks';
import type { IndexSummary } from '../core/library-index';
import type { LibraryInfo, Matches, ToPlugin, ToUi } from '../shared/messages';
import { send, type Scanned } from './bridge';
import { Report, type Decisions, type Preview } from './Report';

type Matched = Extract<ToUi, { type: 'matched' }>;

const date = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Решение по умолчанию: уверенные пары — заменить, остальное — ждёт дизайнера. */
function defaultDecisions(matches: Matches): Decisions {
  const out: Decisions = {};
  for (const [id, m] of Object.entries(matches)) out[id] = m.status === 'exact' && m.target ? m.target.key : '';
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

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data?.pluginMessage as ToUi | undefined;
      if (!msg) return;
      if (msg.type === 'init') {
        setLibrary(msg.library);
        setLibraries(msg.libraries);
        setIndexes(msg.indexes);
        setReady(true);
      } else if (msg.type === 'progress') setBusy(msg.text);
      else if (msg.type === 'indexed') {
        setIndexes((all) => [...all.filter((i) => i.libraryId !== msg.summary.libraryId), msg.summary]);
        setBusy(null);
      } else if (msg.type === 'scanned') {
        setScanned(msg);
        setPreviews({});
      } else if (msg.type === 'matched') {
        setMatched(msg);
        setDecisions(defaultDecisions(msg.matches));
        setBusy(null);
      } else if (msg.type === 'preview') {
        const url = (bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setPreviews((all) => ({
          ...all,
          [msg.groupId]: { targetKey: msg.targetKey, before: url(msg.before), after: url(msg.after), pick: msg.pick, lost: msg.lost, sizeChanged: msg.sizeChanged },
        }));
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

  return (
    <>
      <header>
        <h1>Components Swapper</h1>
        <p>{library ? `Файл библиотеки: ${library.name}` : 'Макет: компоненты не из библиотек WB AID → наши'}</p>
      </header>
      <main>
        {(library || !scanned) && <Indexes libraries={libraries} indexes={indexes} current={library} />}
        {!library && scanned && (
          <Report
            scanned={scanned}
            matched={matched}
            decisions={decisions}
            previews={previews}
            busy={!!busy}
            onDecide={(id, key) => setDecisions((d) => ({ ...d, [id]: key }))}
            onProduct={(product) => run({ type: 'set-product', product }, 'Подбираю…')}
            onPreview={(groupId, target) => run({ type: 'preview', groupId, target }, 'Примерка…')}
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
          <button class={scanned ? '' : 'primary'} disabled={!!busy || !indexes.length} onClick={() => run({ type: 'scan' }, 'Сканирую…')}>
            {scanned ? 'Пересканировать' : 'Сканировать'}
          </button>
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
