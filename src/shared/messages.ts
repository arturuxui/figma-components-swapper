// Сообщения между кодом плагина (sandbox) и UI (iframe).

import type { IndexSummary, LibraryKind } from '../core/library-index';
import type { ScanReport } from '../core/scan-report';

export interface LibraryInfo {
  id: string;
  product: string;
  kind: LibraryKind;
  name: string;
  /** Для шапки: «Driver · компоненты». */
  short: string;
  url: string;
}

export type ScanScope = 'selection' | 'page';

export type ToUi =
  | { type: 'init'; library: LibraryInfo | null; libraries: LibraryInfo[]; indexes: IndexSummary[] }
  | { type: 'progress'; text: string }
  | { type: 'indexed'; summary: IndexSummary }
  | { type: 'scanned'; report: ScanReport; scope: ScanScope; scopeName: string; unreadable: number }
  | { type: 'error'; message: string };

export type ToPlugin =
  | { type: 'build-index' }
  | { type: 'scan' }
  | { type: 'focus'; nodeId: string }
  | { type: 'open-library'; url: string };
