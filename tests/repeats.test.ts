import { describe, expect, it } from 'vitest';
import { findRepeats } from '../src/core/repeats';
import type { StructNode } from '../src/core/structure';

let seq = 0;
const id = () => `n${++seq}`;
const text = (characters: string): StructNode => ({ id: id(), type: 'TEXT', name: 't', characters, width: 100, height: 20 });
const icon = (mainName: string): StructNode => ({ id: id(), type: 'INSTANCE', name: 'icon', mainName, width: 24, height: 24 });
const frame = (name: string, w: number, h: number, children: StructNode[], extra: Partial<StructNode> = {}): StructNode => ({
  id: id(),
  type: 'FRAME',
  name,
  width: w,
  height: h,
  layoutMode: 'HORIZONTAL',
  visual: true,
  children,
  ...extra,
});
// Строка «иконка + название + цена»: внутри — фрейм с двумя текстами (тоже повторяется, но вложенный).
const row = (title: string, price: string, ic = 'car') => frame('trip row', 328, 56, [icon(ic), frame('texts', 200, 40, [text(title), text(price)], { visual: false, layoutMode: 'VERTICAL' })]);
const screen = (name: string, children: StructNode[]): { ref: { id: string; name: string }; tree: StructNode } => {
  const tree = frame(name, 360, 720, children, { layoutMode: 'VERTICAL' });
  return { ref: { id: tree.id!, name }, tree };
};

describe('findRepeats', () => {
  it('строка на трёх экранах — один повтор; фрейм с текстами внутри — вложенный, с привязкой к строке', () => {
    const screens = [
      screen('A', [row('Эконом', '300 ₽')]),
      screen('B', [row('Комфорт', '450 ₽')]),
      screen('C', [row('Бизнес', '900 ₽', 'star')]),
    ];
    const r = findRepeats(screens);
    expect(r.filter((g) => !g.nestedIn)).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'trip row', count: 3, screens: 3, texts: 2, icons: 1, varying: { texts: 2, icons: 1 }, varyingAt: { texts: [0, 1], icons: [0] } });
    expect(r[1]).toMatchObject({ name: 'texts', count: 3, nestedIn: r[0].id });
  });

  it('на двух экранах и в четырёх местах — ещё не повтор', () => {
    const screens = [screen('A', [row('a', '1'), row('b', '2')]), screen('B', [row('c', '3'), row('d', '4')])];
    expect(findRepeats(screens)).toEqual([]);
  });

  it('пять мест на одном экране — повтор', () => {
    const screens = [screen('A', [1, 2, 3, 4, 5].map((i) => row(`Тариф ${i}`, `${i}00 ₽`)))];
    expect(findRepeats(screens)[0]).toMatchObject({ count: 5, screens: 1 });
  });

  it('копии наших компонентов (пара из 2б) не считаются', () => {
    const screens = [screen('A', [row('a', '1')]), screen('B', [row('b', '2')]), screen('C', [row('c', '3')])];
    const rows = screens.map((s) => s.tree.children![0].id!);
    const found = findRepeats(screens, new Set(rows)).map((g) => g.name);
    expect(found).not.toContain('trip row');
    // и содержимое копии нашего компонента — тоже не повтор
    expect(found).not.toContain('texts');
  });

  it('один текст без иконок — слишком просто для компонента', () => {
    const pill = () => frame('pill', 80, 32, [text('Скролл')]);
    expect(findRepeats([screen('A', [pill()]), screen('B', [pill()]), screen('C', [pill()])])).toEqual([]);
  });

  it('внутри экземпляров и отвязанных фреймов не ищем', () => {
    const inInstance = (): StructNode => ({ id: id(), type: 'INSTANCE', name: 'card', mainName: 'card', width: 328, height: 80, children: [row('a', '1')] });
    const detached = () => frame('old row', 328, 56, [icon('car'), text('a'), text('1')], { detached: true });
    expect(findRepeats([screen('A', [inInstance(), detached()]), screen('B', [inInstance(), detached()]), screen('C', [inInstance(), detached()])])).toEqual([]);
  });

  it('скрытое не входит в отпечаток: строка со скрытой иконкой — то же устройство, что без неё', () => {
    const withHidden = () => frame('row', 328, 56, [{ ...icon('x'), visible: false }, text('a'), text('b')]);
    const plain = () => frame('row', 328, 56, [text('a'), text('b')]);
    expect(findRepeats([screen('A', [withHidden()]), screen('B', [plain()]), screen('C', [plain()])])[0]).toMatchObject({ count: 3 });
  });
});

describe('findRepeats — часть экрана и похожие на наши', () => {
  it('блок почти во весь экран — часть экрана, не компонент', () => {
    const sheet = () => frame('Bottom Sheet', 360, 632, [icon('car'), text('Предзаказы'), text('в 21:45')]);
    expect(findRepeats([screen('A', [sheet()]), screen('B', [sheet()]), screen('C', [sheet()])]).map((r) => r.name)).not.toContain('Bottom Sheet');
  });

  it('устроен как наш компонент — помечен и в конце списка', () => {
    const card = () => frame('Frame 500', 158, 148, [icon('car'), text('Минивен')], { layoutMode: 'NONE' });
    const tariff = { key: 't', isSet: false, name: 'tariff', libraryId: 'l', product: 'driver', kind: 'components' as const, sizes: [{ width: 158, height: 148 }], shape: { width: 158, height: 148, layoutMode: 'NONE', textCount: 1, iconCount: 1, parts: [] } };
    const screens = [screen('A', [card(), row('a', '1')]), screen('B', [card(), row('b', '2')]), screen('C', [card(), row('c', '3')])];
    const r = findRepeats(screens, new Set(), [tariff]);
    expect(r.filter((g) => !g.nestedIn).map((g) => [g.name, g.likeOurs])).toEqual([
      ['trip row', undefined],
      ['Frame 500', 'tariff'],
    ]);
  });
});
