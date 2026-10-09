// Сообщения между кодом плагина (sandbox) и UI (iframe).

import type { ApplyResult } from '../figma/apply';
import type { IndexSummary, LibraryKind } from '../core/library-index';
import type { Candidate, MatchResult } from '../core/match';
import type { ScanReport } from '../core/scan-report';
import type { VariantPick } from '../core/variants';

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

/** Подбор по имени для групп экземпляров «заменить»: id группы → результат. */
export type Matches = Record<string, MatchResult>;

export type TargetRef = Pick<Candidate, 'key' | 'isSet'>;

export type ToUi =
  | { type: 'init'; library: LibraryInfo | null; libraries: LibraryInfo[]; indexes: IndexSummary[] }
  | { type: 'progress'; text: string }
  | { type: 'indexed'; summary: IndexSummary }
  | { type: 'scanned'; report: ScanReport; scope: ScanScope; scopeName: string; unreadable: number }
  | { type: 'matched'; product: string | null; products: string[]; matches: Matches }
  | {
      type: 'preview';
      groupId: string;
      targetKey: string;
      before: Uint8Array;
      after: Uint8Array;
      pick: VariantPick | null;
      lost: string[];
      sizeChanged: boolean;
      placeholders?: string[];
      iconsMissing?: string[];
      score?: number;
    }
  | { type: 'applied'; result: ApplyResult }
  | { type: 'undone'; restored: number; failed: number }
  | { type: 'error'; message: string };

export type ToPlugin =
  | { type: 'build-index' }
  | { type: 'scan' }
  | { type: 'set-product'; product: string }
  | { type: 'preview'; groupId: string; target: TargetRef }
  | { type: 'apply'; choices: { groupId: string; target: TargetRef }[] }
  | { type: 'undo' }
  | { type: 'focus'; nodeId: string }
  | { type: 'open-library'; url: string };
