import { describe, expect, it } from 'vitest';
import { buildLookup, INDEX_FORMAT, isPrivateName, parseVariantName, summarizeIndex, type LibraryIndex } from '../src/core/library-index';

const index: LibraryIndex = {
  format: INDEX_FORMAT,
  libraryId: 'driver-components',
  product: 'driver',
  kind: 'components',
  fileKey: 'f',
  takenAt: '2026-10-09T10:00:00.000Z',
  sets: [{ key: 'set-btn', name: 'button', axes: { Size: ['M', 'L'] }, variants: 2 }],
  entries: [
    { key: 'btn-m', name: 'Size=M', setKey: 'set-btn', setName: 'button', variant: { Size: 'M' }, width: 100, height: 40, page: 'Buttons' },
    { key: 'btn-l', name: 'Size=L', setKey: 'set-btn', setName: 'button', variant: { Size: 'L' }, width: 120, height: 48, page: 'Buttons' },
    { key: 'divider', name: 'divider', width: 360, height: 1, page: 'Misc' },
  ],
};

describe('parseVariantName', () => {
  it('разбирает оси варианта', () => {
    expect(parseVariantName('Size=M, State=Default')).toEqual({ Size: 'M', State: 'Default' });
  });
  it('не вариант — null', () => {
    expect(parseVariantName('button/primary')).toBeNull();
    expect(parseVariantName('=M')).toBeNull();
  });
});

describe('isPrivateName', () => {
  it('точка и подчёркивание в начале — не публикуется', () => {
    expect(isPrivateName('.base')).toBe(true);
    expect(isPrivateName('_helper')).toBe(true);
    expect(isPrivateName('button')).toBe(false);
  });
});

describe('buildLookup', () => {
  it('находит наборы, варианты и одиночные компоненты', () => {
    const lookup = buildLookup([index]);
    expect(lookup.get('set-btn')?.name).toBe('button');
    expect(lookup.get('btn-l')?.name).toBe('button / Size=L');
    expect(lookup.get('divider')).toMatchObject({ libraryId: 'driver-components', kind: 'components' });
    expect(lookup.has('foreign')).toBe(false);
  });
});

describe('summarizeIndex', () => {
  it('считает компоненты и наборы', () => {
    expect(summarizeIndex(index)).toEqual({ libraryId: 'driver-components', takenAt: index.takenAt, components: 3, sets: 1 });
  });
});
