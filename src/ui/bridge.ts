// Отправка команд коду плагина.

import type { ToPlugin, ToUi } from '../shared/messages';

export const send = (msg: ToPlugin) => parent.postMessage({ pluginMessage: msg }, '*');

export type Scanned = Extract<ToUi, { type: 'scanned' }>;
