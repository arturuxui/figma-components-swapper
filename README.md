# Components Swapper

Плагин Figma для команды WB AID: находит в макетах компоненты и иконки не из библиотек WB AID Rider/Driver
и заменяет их на наши с сохранением контента. План и этапы — [docs/PLAN.md](docs/PLAN.md).

Сборка: `npm ci`, потом `npm run build` (по отдельности: Windows PowerShell 5.1 не понимает `&&`), затем в Figma — Plugins → Development → Import plugin from manifest (`manifest.json`).
