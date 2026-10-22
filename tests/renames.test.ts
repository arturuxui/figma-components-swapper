import { describe, expect, it } from 'vitest';
import { INDEX_FORMAT, type LibraryIndex } from '../src/core/library-index';
import { buildCandidates, matchByName } from '../src/core/match';
import { mergeRenames, parseRenames, renameAliases, staleness, type RenameEntry } from '../src/core/renames';

const entry = (p: Partial<RenameEntry>): RenameEntry => ({
  id: 'e1',
  libraryId: 'rider-icons',
  fileKey: 'n6Lpp',
  publishedAt: '2026-10-21T10:00:00Z',
  renamed: [],
  deleted: [],
  added: [],
  ...p,
});

const icons: LibraryIndex = {
  format: INDEX_FORMAT,
  libraryId: 'rider-icons',
  product: 'rider',
  kind: 'icons',
  fileKey: 'n6Lpp',
  takenAt: '2026-10-20T00:00:00Z',
  entries: [
    { key: 'k-add', name: 'ic_add_circle_fill', width: 24, height: 24, page: 'Icons' },
    { key: 'k-old', name: 'ic_ride_experience', width: 24, height: 24, page: 'Icons' },
  ],
  sets: [],
};

describe('parseRenames — ответ сервера', () => {
  it('битые записи и элементы без ключа отбрасываются, курсор сохраняется', () => {
    const r = parseRenames({ entries: [entry({ renamed: [{ kind: 'component', key: 'k', from: 'a', to: 'b' }, { bad: 1 } as never] }), { nope: true }], cursor: '2026-10-21T10:00:00Z' });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].renamed).toHaveLength(1);
    expect(r.cursor).toBe('2026-10-21T10:00:00Z');
  });
  it('не тот ответ — пусто, без падения', () => {
    expect(parseRenames(null)).toEqual({ entries: [], cursor: null });
    expect(parseRenames({ error: 'x' })).toEqual({ entries: [], cursor: null });
  });
});

describe('mergeRenames', () => {
  it('без повторов по id, по дате', () => {
    const a = entry({ id: 'a', publishedAt: '2026-10-02' }), b = entry({ id: 'b', publishedAt: '2026-10-01' });
    expect(mergeRenames([a], [b, a]).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('renameAliases', () => {
  it('все имена ключа; переименования вариантов (смена оси) не берутся', () => {
    const m = renameAliases([
      entry({ renamed: [{ kind: 'component', key: 'k-add', from: 'ic_add_circle', to: 'ic_add_circle_fill' }] }),
      entry({ id: 'e2', renamed: [{ kind: 'component', key: 'v1', from: 'State=On', to: 'State=Active', setKey: 's1', setName: 'Toggle' }] }),
    ]);
    expect(m.get('k-add')).toEqual(['ic_add_circle', 'ic_add_circle_fill']);
    expect(m.has('v1')).toBe(false);
  });
  it('старое имя в макете находит наш компонент под новым — точная пара', () => {
    const renamed = renameAliases([entry({ renamed: [{ kind: 'component', key: 'k-add', from: 'ic_add_circle', to: 'ic_add_circle_fill' }] })]);
    expect(matchByName('ic_add_circle', { width: 24, height: 24 }, buildCandidates([icons]), 'rider').status).toBe('none');
    expect(matchByName('ic_add_circle', { width: 24, height: 24 }, buildCandidates([icons], { renamed }), 'rider')).toMatchObject({ status: 'exact', target: { key: 'k-add' } });
  });
});

describe('staleness — изменения после сборки индекса', () => {
  const entries = [
    entry({ id: 'before', publishedAt: '2026-10-19T00:00:00Z', added: [{ kind: 'component', key: 'x', name: 'ic_x' }] }),
    entry({
      id: 'after',
      deleted: [{ kind: 'component', key: 'k-old', name: 'ic_ride_experience' }],
      added: [
        { kind: 'component', key: 'n1', name: 'ic_new' },
        { kind: 'component', key: 'v9', name: 'Size=L', setKey: 's', setName: 'Set' },
        { kind: 'style', key: 'st', name: 'Color' },
      ],
    }),
  ];
  const s = staleness(entries, [icons]);
  it('считаются только публикации позже индекса; варианты и стили — нет', () => {
    expect(s.added).toBe(1);
    expect(s.removedNames).toEqual(['ic_ride_experience']);
  });
  it('удалённые уходят из подбора', () => {
    const byName = buildCandidates([icons], { removed: s.removed });
    expect(matchByName('ic_ride_experience', { width: 24, height: 24 }, byName, 'rider').status).toBe('none');
  });
});
