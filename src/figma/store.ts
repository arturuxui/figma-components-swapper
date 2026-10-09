// Индексы библиотек в `clientStorage`: он общий для всех файлов одного пользователя, поэтому индекс,
// собранный в файле библиотеки, виден в любом макете. Позже индексы переедут на сервер (свой Worker),
// интерфейс модуля останется тем же.

import { INDEX_FORMAT, summarizeIndex, type IndexSummary, type LibraryIndex } from '../core/library-index';

const INDEX = (libraryId: string) => `index:${libraryId}`;

export const saveIndex = (index: LibraryIndex) => figma.clientStorage.setAsync(INDEX(index.libraryId), index);

/** Индекс старого формата считается отсутствующим — его нужно пересобрать. */
export async function loadIndex(libraryId: string): Promise<LibraryIndex | undefined> {
  const index = (await figma.clientStorage.getAsync(INDEX(libraryId))) as LibraryIndex | undefined;
  return index?.format === INDEX_FORMAT ? index : undefined;
}

export async function loadIndexes(libraryIds: readonly string[]): Promise<LibraryIndex[]> {
  const out: LibraryIndex[] = [];
  for (const id of libraryIds) {
    const index = await loadIndex(id);
    if (index) out.push(index);
  }
  return out;
}

export const summaries = (indexes: readonly LibraryIndex[]): IndexSummary[] => indexes.map(summarizeIndex);
