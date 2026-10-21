# Components Swapper

Плагин Figma для команды WB AID: находит в макетах компоненты и иконки не из библиотек WB AID Rider/Driver
и заменяет их на наши с сохранением контента. План и этапы — [docs/PLAN.md](docs/PLAN.md).

Сборка: `npm ci`, потом `npm run build` (по отдельности: Windows PowerShell 5.1 не понимает `&&`), затем в Figma — Plugins → Development → Import plugin from manifest (`manifest.json`).

## Для дизайнеров

Готовый плагин — в [релизах](https://github.com/arturuxui/figma-components-swapper/releases): скачайте архив,
распакуйте, в Figma Desktop — Plugins → Development → Import plugin from manifest… → `manifest.json`.
Что умеет и как работать — в описании релиза ([docs/releases](docs/releases)).

## Релиз

Версия — в `package.json` (видна в заголовке окна плагина). Архив `components-swapper-vX.Y.Z.zip` собирается из `main`:
папка `Components Swapper` с `manifest.json` и `dist/`; заметки — `docs/releases/vX.Y.Z.md`.
