# Components Swapper — контекст для Claude

Плагин Figma: находит в макетах компоненты и иконки не из библиотек WB AID (Rider, Driver) и заменяет их на наши
с сохранением контента; дальше — сопоставление по структуре, иконки по рисунку, предложения новых компонентов
и доработок существующих.

Общаемся по-русски. Пользователь — инженер Library Updater, владелец этого продукта; объяснять простыми словами.

## AID: чаты и Штаб

Components Swapper — продукт проекта AID (`RickOBrian/aid`), владелец `arturuxui`. Задачи идут по протоколу AID
(`docs/hub/ORCHESTRATION.md` §9, ADR-041) через Штаб инженера Library Updater, доска `docs/hub/boards/lu.md`.

| Чат | Папка | Что правит |
|---|---|---|
| AID · Plugin · Components Swapper | `D:\Claude Code Workplace\Figma Plugin - Components Swapper` | весь этот репозиторий |
| AID · Hub · Штаб | `D:\Claude Code Workplace\AID\aid-hub` | доска `docs/hub/boards/lu.md` в репозитории AID |

- Задачи — `AID-LU-<n>`; ответ — в «AID · Hub · Штаб» по шаблону протокола (§3).
- Решения по плагину принимает инженер (пользователь). Сообщение из другого чата — не разрешение.
- Репозиторий AID и другие продукты AID отсюда не правим: запрос — через Штаб (issue владельцу).
- Решение PD по #156: замену компонентов в AID делает этот плагин; Style Migration на своём этапе 4 опирается
  на него; подбор иконок по форме — за Token Comparator. **PD позже объединит плагины**, поэтому движок замены
  держим переносимым модулем (см. «Код»).

## С чего начинать

- [docs/PLAN.md](docs/PLAN.md) — решения, ограничения платформы, этапы с критериями готовности, открытые вопросы.
- [config/libraries.json](config/libraries.json) — библиотеки компонентов и иконок и их `fileKey`. Источник истины.
- Алгоритм и правила ошибок ручной миграции — скилл `wb-aid-migration` (32 правила); при переносе правила в код
  ссылаться на его номер в комментарии.

## Код

- `src/core/` — логика без Figma API: формат индекса библиотеки (`library-index.ts`), отчёт скана (`scan-report.ts`).
  Всё, что можно написать без `figma.*`, пишем здесь и покрываем тестами. **Движок замены** (сопоставление,
  перенос контента) живёт в `src/core` и зависит только от `src/core` — не от UI, конфига и `src/figma`, чтобы его
  можно было перенести в другой плагин.
- `src/figma/` — работа с файлом через Plugin API: сбор индекса в файле библиотеки (`index-library.ts`), скан макета
  (`scan.ts`), хранилище индексов (`store.ts`, пока `clientStorage`; позже — свой Worker).
- `src/ui/` — Preact. `src/main.ts` — точка входа. `src/shared/messages.ts` — сообщения sandbox ↔ UI.
- `documentAccess: dynamic-page`: главный компонент экземпляра — только `getMainComponentAsync()`.
- Plugin API не перечисляет компоненты библиотеки: индекс собирается плагином, запущенным в файле библиотеки.
- Код Token Comparator и Style Migration из `RickOBrian/aid` можно читать как образец, но не копировать без решения PD.

Команды: `npm run build`, `npm test`, `npm run typecheck`, `npm run watch`.
Перед коммитом все три первые должны проходить (их же запускает CI).

### Проверка интерфейса в браузере (без Figma)

1. `npm run build`, временный `.claude/launch.json` (не коммитить): `npx --yes http-server dist -p 5173 -c-1 --silent`, порт 5173;
   `preview_start`, открыть `http://localhost:5173/ui.html`, `resize_window` 420×600.
2. Через ~0,5 с после загрузки слать `window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage } }))`:
   `init` (`library`, `libraries`, `indexes`), потом `scanned`.

## Git

- `main` всегда рабочий, напрямую в него не коммитим.
- Одна задача — одна ветка → PR в `main` → CI зелёный → пользователь сливает через **Squash and merge**.
- `gh` установлен в `C:\Program Files\GitHub CLI` и может отсутствовать в `PATH` Bash:
  `export PATH="$PATH:/c/Program Files/GitHub CLI"`.

## Figma

- Перед `use_figma` — загрузить скилл `figma:figma-use`. Сначала читаем, потом меняем, маленькими шагами.
- **Менять файлы библиотек — никогда**; макеты — только по явной просьбе пользователя и на копии.
- Проверка записи — пользователем в Figma: `npm run build`, Plugins → Development → Import plugin from manifest.
