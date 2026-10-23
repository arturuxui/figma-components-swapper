// Сообщения между кодом плагина (sandbox) и UI (iframe).

import type { AdoptionJson, AdoptionResult } from '../core/adoption';
import type { ApplyResult } from '../figma/apply';
import type { IndexSummary, LibraryKind } from '../core/library-index';
import type { Candidate, MatchResult } from '../core/match';
import type { OverrideChoice, OverrideGroup } from '../core/overrides';
import type { RepeatGroup } from '../core/repeats';
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

export interface PageRef {
  id: string;
  name: string;
}

export type ScanScope = 'selection' | 'page';

/** Подбор по имени для групп экземпляров «заменить»: id группы → результат. */
export type Matches = Record<string, MatchResult>;

export type TargetRef = Pick<Candidate, 'key' | 'isSet'>;

export type ToUi =
  | { type: 'init'; library: LibraryInfo | null; libraries: LibraryInfo[]; indexes: IndexSummary[]; pages: PageRef[]; currentPageId: string }
  | { type: 'progress'; text: string }
  | { type: 'indexed'; summary: IndexSummary }
  | { type: 'scanned'; report: ScanReport; scope: ScanScope; scopeName: string; unreadable: number; repeats: RepeatGroup[]; overrides: OverrideGroup[] }
  | { type: 'matched'; product: string | null; products: string[]; matches: Matches; icons?: IconCheck; renames?: RenameCheck }
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
  | { type: 'proposed'; pageName: string; drafts: number; missing: string[] }
  | { type: 'measured'; result: AdoptionResult; json: AdoptionJson; unreadable: number; inSets: number; products: string[]; legacy: { indexed: string[]; missing: string[] } }
  | { type: 'error'; message: string };

export type ToPlugin =
  | { type: 'build-index' }
  | { type: 'scan' }
  | { type: 'set-product'; product: string }
  | { type: 'preview'; groupId: string; target: TargetRef }
  | { type: 'apply'; choices: { groupId: string; target: TargetRef }[]; overrides?: Record<string, OverrideChoice> }
  | { type: 'undo' }
  | { type: 'settle'; overrides: Record<string, OverrideChoice> }
  | { type: 'focus'; nodeId: string }
  | { type: 'select'; nodeIds: string[] }
  | { type: 'propose'; ids: string[] }
  | { type: 'open-library'; url: string }
  /** Замер внедрения AID (AID-LU-19): страницы; продукт не задан — угадывается по старым компонентам. */
  | { type: 'measure'; pageIds: string[]; product?: string };

/** Сверка отпечатков иконок с актуальной библиотекой при скане (этап 3). */
export interface IconCheck {
  /** Сколько предложенных иконок подгружено и сверено. */
  checked: number;
  /** Перерисованы с момента индекса — подбор шёл по новому рисунку. */
  changed: string[];
  /** Нет в библиотеке (удалены или сняты с публикации) — из подбора убраны. */
  removed: string[];
}

/** Карта переименований библиотек с сервера Library Updater (AID-LU-18) при скане. */
export interface RenameCheck {
  /** Сколько публикаций с изменениями известно. */
  entries: number;
  /** Сколько наших компонентов и наборов подбираются и под прежними именами. */
  renamed: number;
  /** Удалены из библиотеки после сборки индекса — из подбора убраны. */
  removed: string[];
  /** Добавлено после сборки индекса — видно только после пересборки. */
  added: number;
  /** Библиотеки, по которым сервер не ответил (взята сохранённая карта). */
  offline: string[];
}
