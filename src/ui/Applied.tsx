// Итог применения: сколько заменено, что проверить глазами, отмена.

import type { ApplyIssue, ApplyResult } from '../figma/apply';
import { send } from './bridge';

export function Applied({ result: r, undone }: { result: ApplyResult; undone: { restored: number; failed: number } | null }) {
  if (undone) {
    return (
      <section class="card">
        <h2>Замена отменена</h2>
        <p>
          Возвращено мест: {undone.restored}
          {undone.failed ? ` · не удалось вернуть: ${undone.failed} (слои удалены или изменены — проверьте Ctrl+Z)` : ''}
        </p>
      </section>
    );
  }
  return (
    <>
      <div class="totals">
        <Total n={r.replaced} label={r.frames ? `заменено (фреймов ${r.frames})` : 'заменено'} />
        <Total n={r.nested} label="вложенных" />
        <Total n={r.skipped} label="пропущено" />
      </div>
      <p class="muted">
        Пропущены места, которые изменились после скана. Отменить можно кнопкой «Отменить» или Ctrl+Z.
        {r.axesMissing ? ` У ${r.axesMissing} мест не все оси варианта нашлись у нашего набора — по ним вариант по умолчанию.` : ''}
      </p>
      <Issues title="Пропали тексты — проверьте" items={r.lostTexts} />
      <Issues title="Фреймы: осталось от компонента — проверьте" items={r.leftovers} />
      <Issues title="Ошибки" items={r.errors} />
      {!r.lostTexts.length && !r.errors.length && <p>Тексты сохранились везде. Пересканируйте, чтобы увидеть, что осталось.</p>}
    </>
  );
}

const Total = ({ n, label }: { n: number; label: string }) => (
  <div class="card">
    <div class="num">{n}</div>
    <div class="muted">{label}</div>
  </div>
);

function Issues({ title, items }: { title: string; items: ApplyIssue[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h2>
        {title} · {items.length}
      </h2>
      <ul class="rows">
        {items.map((i) => (
          <li key={i.nodeId}>
            <span class="name" title={i.message}>
              {i.name}: {i.message}
            </span>
            <button class="link" onClick={() => send({ type: 'focus', nodeId: i.nodeId })}>
              Показать
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
