import { describe, expect, it } from 'vitest';
import { adoptionItem, adoptionJson, countAdoption, type AdoptionFinding } from '../src/core/adoption';

const aid = new Map<string, { kind: 'components' | 'icons' }>([
  ['k-button', { kind: 'components' }],
  ['set-list', { kind: 'components' }],
  ['k-ic-close', { kind: 'icons' }],
]);
const f = (p: Partial<AdoptionFinding>): AdoptionFinding => ({ componentKey: 'x', name: 'x', remote: true, width: 100, height: 40, hidden: false, ...p });
const noAnalog = () => false;

describe('adoptionItem — источник по ключу', () => {
  it('ключ из индекса AID (компонент или набор) — aid', () => {
    expect(adoptionItem(f({ componentKey: 'k-button' }), aid, noAnalog)).toMatchObject({ source: 'aid', icon: false });
    expect(adoptionItem(f({ componentKey: 'variant', setKey: 'set-list' }), aid, noAnalog).source).toBe('aid');
  });
  it('внешний не из AID — legacy, свой в файле — local', () => {
    expect(adoptionItem(f({ remote: true }), aid, noAnalog).source).toBe('legacy');
    expect(adoptionItem(f({ remote: false }), aid, noAnalog).source).toBe('local');
  });
  it('иконка AID — по индексу иконок, даже крупная; чужая — до 48 px', () => {
    expect(adoptionItem(f({ componentKey: 'k-ic-close', width: 72, height: 72 }), aid, noAnalog).icon).toBe(true);
    expect(adoptionItem(f({ width: 24, height: 24 }), aid, noAnalog).icon).toBe(true);
    expect(adoptionItem(f({ width: 49, height: 24 }), aid, noAnalog).icon).toBe(false);
  });
  it('аналог — только у старых компонентов, не у иконок', () => {
    const yes = () => true;
    expect(adoptionItem(f({}), aid, yes).analog).toBe(true);
    expect(adoptionItem(f({ width: 24, height: 24 }), aid, yes).analog).toBe(false);
    expect(adoptionItem(f({ remote: false }), aid, yes).analog).toBe(false);
  });
});

describe('countAdoption', () => {
  const items = [
    { source: 'aid', icon: false, hidden: false, unit: 'a', analog: false },
    { source: 'legacy', icon: false, hidden: false, unit: 'l1', analog: true },
    { source: 'legacy', icon: false, hidden: false, unit: 'l1', analog: true },
    { source: 'legacy', icon: false, hidden: false, unit: 'l2', analog: false },
    { source: 'legacy', icon: false, hidden: true, unit: 'l3', analog: true },
    { source: 'local', icon: true, hidden: false, unit: 'i', analog: false },
  ] as const;
  const r = countAdoption(items);
  it('скрытые не входят в счёт, считаются отдельно', () => {
    expect(r.components).toEqual({ aid: 1, legacy: 3, local: 0, other: 0 });
    expect(r.hidden.components).toEqual({ aid: 0, legacy: 1, local: 0, other: 0 });
  });
  it('иконки — отдельной строкой', () => {
    expect(r.icons).toEqual({ aid: 0, legacy: 0, local: 1, other: 0 });
  });
  it('готово к замене — экземпляры; уникальные — рядом', () => {
    expect(r.legacyWithAidAnalog).toBe(2);
    expect(r.unique).toEqual({ legacy: 2, withAnalog: 1 });
  });
  it('JSON — строго формат §5, без лишних полей', () => {
    const json = adoptionJson(r, { product: 'driver', date: '2026-10-22', pages: [{ fileKey: 'F', page: 'Order' }], source: 'test' });
    expect(Object.keys(json)).toEqual(['product', 'date', 'methodVersion', 'sample', 'components', 'icons', 'legacyWithAidAnalog', 'source']);
    expect(json).toMatchObject({ methodVersion: '0.1.0', sample: { version: 1, pages: [{ fileKey: 'F', page: 'Order' }] }, legacyWithAidAnalog: 2 });
  });
});
