// Окно плагина. В файле библиотеки — сбор индекса, в макете — скан и отчёт (этап 1а, только чтение).

import { useEffect, useState } from 'preact/hooks';
import type { IndexSummary } from '../core/library-index';
import type { Origin, ReportGroup } from '../core/scan-report';
import type { LibraryInfo, ToPlugin, ToUi } from '../shared/messages';

const send = (msg: ToPlugin) => parent.postMessage({ pluginMessage: msg }, '*');

type Scanned = Extract<ToUi, { type: 'scanned' }>;

const ORIGIN_LABEL: Record<Origin, string> = { foreign: 'Чужой', local: 'Локальный', ours: 'Наш' };

const date = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function App() {
  const [library, setLibrary] = useState<LibraryInfo | null>(null);
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Scanned | null>(null);

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
        <p>{library ? `Файл библиотеки: ${library.name}` : 'Макет: поиск компонентов не из библиотек WB AID'}</p>
      </header>
      <main>
        <Indexes libraries={libraries} indexes={indexes} current={library} />
        {!library && scanned && <Report scanned={scanned} />}
        {error && <p class="error">{error}</p>}
      </main>
      <footer>
        {library ? (
          <button class="primary" disabled={!!busy} onClick={() => run({ type: 'build-index' }, 'Собираю индекс…')}>
            Собрать индекс
          </button>
        ) : (
          <button class="primary" disabled={!!busy || !indexes.length} onClick={() => run({ type: 'scan' }, 'Сканирую…')}>
            Сканировать
          </button>
        )}
        <span class="muted">{busy ?? (!library ? 'Выделение или вся страница' : '')}</span>
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

function Report({ scanned }: { scanned: Scanned }) {
  const { report, scopeName, unreadable } = scanned;
  const t = report.totals;
  const toChange = report.groups.filter((g) => g.origin !== 'ours');
  const detachedOurs = report.groups.filter((g) => g.origin === 'ours' && g.detached);
  return (
    <>
      <p class="muted">Область: {scopeName}</p>
      <div class="totals">
        <div class="card">
          <div class="num">{t.foreign}</div>
          <div class="muted">чужих экземпляров</div>
        </div>
        <div class="card">
          <div class="num">{t.local}</div>
          <div class="muted">локальных</div>
        </div>
        <div class="card">
          <div class="num">{t.ours}</div>
          <div class="muted">наших</div>
        </div>
      </div>
      <p class="muted">
        Отвязаны от наших компонентов: {t.detachedOurs}, от других: {t.detachedOther}
        {unreadable ? ` · не прочитано экземпляров: ${unreadable}` : ''}
      </p>
      {toChange.length > 0 && <Groups title="Заменить" groups={toChange} />}
      {detachedOurs.length > 0 && <Groups title="Отвязаны от наших — вернуть экземпляр (этап 2)" groups={detachedOurs} />}
      {!toChange.length && !detachedOurs.length && <p>Всё из библиотек WB AID.</p>}
    </>
  );
}

function Groups({ title, groups }: { title: string; groups: ReportGroup[] }) {
  return (
    <section>
      <h2>{title}</h2>
      <ul class="rows">
        {groups.map((g) => (
          <li key={`${g.detached ? 'd' : 'i'}:${g.id}`}>
            <span class={`tag ${g.origin}`}>{g.detached ? 'Отвязан' : ORIGIN_LABEL[g.origin]}</span>
            <span class="name" title={g.name}>
              {g.name}
            </span>
            <span class="muted">
              ×{g.count} · экр. {g.screens}
            </span>
            <button class="link" title={g.exampleScreen} onClick={() => send({ type: 'focus', nodeId: g.exampleNodeId })}>
              Показать
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
