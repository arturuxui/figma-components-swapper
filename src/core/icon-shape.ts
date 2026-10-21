// Иконки по рисунку (этап 3): отпечаток формы и подбор нашей иконки по нему. Без Figma API — часть движка
// замены, зависит только от src/core. Своя реализация (решение инженера 2026-10-21); подход Token Comparator
// (RickOBrian/aid) изучен, код не взят. Общий модуль для плагинов AID выбирает PD (RickOBrian/aid#185) —
// поэтому снаружи модуль виден только через `printIcon`, `iconSimilarity` и `rankIcons`.
//
// Отпечаток — сетка size×size с долей закраски каждой клетки (0–255), а не «закрашено / нет»: тонкие линии
// и скругления сравниваются по площади, а не по тому, попал ли центр клетки в линию. Рисунок вписывается в
// квадрат с сохранением пропорций и по центру — размер, положение и цвет на отпечаток не влияют.
// Похожесть — доля общей закраски (Σmin / Σmax) с допуском сдвига на одну клетку: тот же рисунок, сдвинутый
// на полпикселя при вписывании, не теряет баллы.

export type Point = [number, number];

/** Аффинная матрица как в SVG: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export interface IconPath {
  /** Путь в синтаксисе SVG `d` — так Figma отдаёт `fillGeometry` и `strokeGeometry`. */
  d: string;
  evenOdd?: boolean;
  /** Положение слоя в иконке. */
  transform?: Matrix;
}

export interface IconPrint {
  size: number;
  /** size × size, доля закраски 0–255. */
  cells: Uint8Array;
  /** Сумма закраски — пустой отпечаток (0) ни с чем не совпадает. */
  mass: number;
}

export interface IconCandidate {
  key: string;
  name: string;
  print: IconPrint;
  /** Размер рисунка (без полей компонента) — чтобы среди двойников выбрать ближайший по размеру. */
  glyph?: { width: number; height: number };
  /** Многоцветная (логотип, знак на цветной подложке): её цвета — часть рисунка. */
  multicolor?: boolean;
}

export const PRINT_SIZE = 32;
/** Сколько проб на клетку по каждой оси. */
const SAMPLES = 4;
/** Точность разбиения кривых, px. */
const FLATNESS = 0.2;

// ---------------------------------------------------------------------------
// Путь SVG → ломаные
// ---------------------------------------------------------------------------

const apply = (m: Matrix | undefined, [x, y]: Point): Point => (m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y]);

function bezier(out: Point[], p0: Point, p1: Point, p2: Point, p3: Point) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const steps = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / FLATNESS))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/** Ломаные пути (каждая — замкнутый контур). Команды M L H V C S Q T Z, абсолютные и относительные. */
export function flattenPath(d: string): Point[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Point[][] = [];
  let current: Point[] = [];
  let pos: Point = [0, 0];
  let start: Point = [0, 0];
  let ctrl: Point | null = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const close = () => {
    if (current.length > 1) out.push(current);
    current = [];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Point => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case 'M':
        close();
        pos = at(num(), num());
        start = pos;
        current = [pos];
        ctrl = null;
        cmd = rel ? 'l' : 'L'; // следующие пары — линии
        break;
      case 'L':
        pos = at(num(), num());
        current.push(pos);
        ctrl = null;
        break;
      case 'H':
        pos = [rel ? pos[0] + num() : num(), pos[1]];
        current.push(pos);
        ctrl = null;
        break;
      case 'V':
        pos = [pos[0], rel ? pos[1] + num() : num()];
        current.push(pos);
        ctrl = null;
        break;
      case 'C': {
        const p1 = at(num(), num());
        const p2 = at(num(), num());
        const p3 = at(num(), num());
        bezier(current, pos, p1, p2, p3);
        ctrl = p2;
        pos = p3;
        break;
      }
      case 'S': {
        const p1: Point = ctrl ? [2 * pos[0] - ctrl[0], 2 * pos[1] - ctrl[1]] : pos;
        const p2 = at(num(), num());
        const p3 = at(num(), num());
        bezier(current, pos, p1, p2, p3);
        ctrl = p2;
        pos = p3;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Point = cmd.toUpperCase() === 'Q' ? at(num(), num()) : ctrl ? [2 * pos[0] - ctrl[0], 2 * pos[1] - ctrl[1]] : pos;
        const p3 = at(num(), num());
        // Квадратичная кривая — как кубическая с контрольными точками на 2/3.
        bezier(current, pos, [pos[0] + (2 / 3) * (q[0] - pos[0]), pos[1] + (2 / 3) * (q[1] - pos[1])], [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])], p3);
        ctrl = q;
        pos = p3;
        break;
      }
      case 'Z':
        pos = start;
        close();
        current = [pos];
        ctrl = null;
        break;
      default:
        i++; // A и неизвестное — Figma их не отдаёт; пропускаем число, чтобы не зациклиться
    }
  }
  close();
  return out;
}

/** Размер рисунка — рамка всех путей (без полей компонента). Пусто — undefined. */
export function glyphOf(paths: readonly IconPath[]): { width: number; height: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const c of flattenPath(p.d)) for (const pt of c) {
    const [x, y] = apply(p.transform, pt);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { width: maxX - minX, height: maxY - minY } : undefined;
}

// ---------------------------------------------------------------------------
// Растеризация
// ---------------------------------------------------------------------------

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: 1 | -1;
}

function edgesOf(contours: Point[][]): Edge[] {
  const edges: Edge[] = [];
  for (const c of contours) {
    for (let k = 0; k < c.length; k++) {
      const [ax, ay] = c[k];
      const [bx, by] = c[(k + 1) % c.length];
      if (ay === by) continue;
      edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 } : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
    }
  }
  return edges;
}

/**
 * Отпечаток формы. Рамка — общая рамка рисунка, если не задана (`frame` задают, чтобы сравнивать с полями).
 * Каждая клетка — SAMPLES × SAMPLES проб; проба внутри, если внутри хотя бы одного пути (по его правилу заливки).
 */
export function printIcon(paths: readonly IconPath[], size = PRINT_SIZE, frame?: { x: number; y: number; width: number; height: number }): IconPrint {
  const shapes = paths.map((p) => ({ edges: edgesOf(flattenPath(p.d).map((c) => c.map((pt) => apply(p.transform, pt)))), evenOdd: !!p.evenOdd }));
  let box = frame;
  if (!box) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) for (const e of s.edges) {
      minX = Math.min(minX, e.x0, e.x1);
      maxX = Math.max(maxX, e.x0, e.x1);
      minY = Math.min(minY, e.y0);
      maxY = Math.max(maxY, e.y1);
    }
    box = Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : undefined;
  }
  const cells = new Uint8Array(size * size);
  if (!box || (box.width <= 0 && box.height <= 0)) return { size, cells, mass: 0 };
  const side = Math.max(box.width, box.height);
  const step = side / (size * SAMPLES);
  const ox = box.x - (side - box.width) / 2;
  const oy = box.y - (side - box.height) / 2;
  const n = size * SAMPLES;
  const hits = new Uint16Array(size * size);
  const covered = new Uint8Array(n);
  for (let sy = 0; sy < n; sy++) {
    const y = oy + (sy + 0.5) * step;
    covered.fill(0);
    for (const s of shapes) {
      // Пересечения луча со сторонами: x и направление, по ним — отрезки внутри.
      const xs: [number, number][] = [];
      for (const e of s.edges) if (y >= e.y0 && y < e.y1) xs.push([e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), e.dir]);
      xs.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        winding += xs[k][1];
        const inside = s.evenOdd ? (k + 1) % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const from = Math.max(0, Math.ceil((xs[k][0] - ox) / step - 0.5));
        const to = Math.min(n - 1, Math.floor((xs[k + 1][0] - ox) / step - 0.5));
        for (let sx = from; sx <= to; sx++) covered[sx] = 1;
      }
    }
    const row = Math.floor(sy / SAMPLES) * size;
    for (let sx = 0; sx < n; sx++) if (covered[sx]) hits[row + Math.floor(sx / SAMPLES)]++;
  }
  let mass = 0;
  for (let k = 0; k < cells.length; k++) {
    cells[k] = Math.round((hits[k] / (SAMPLES * SAMPLES)) * 255);
    mass += cells[k];
  }
  return { size, cells, mass };
}

// ---------------------------------------------------------------------------
// Сравнение
// ---------------------------------------------------------------------------

/** Доля общей закраски при сдвиге b на (dx, dy) клеток. */
function overlap(a: IconPrint, b: IconPrint, dx: number, dy: number): number {
  const n = a.size;
  let min = 0;
  let max = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const va = a.cells[y * n + x];
      const bx = x - dx;
      const by = y - dy;
      const vb = bx >= 0 && bx < n && by >= 0 && by < n ? b.cells[by * n + bx] : 0;
      min += va < vb ? va : vb;
      max += va > vb ? va : vb;
    }
  }
  return max === 0 ? 0 : min / max;
}

/** Похожесть формы, 0..1: лучшая доля общей закраски со сдвигом до `shift` клеток. */
export function iconSimilarity(a: IconPrint, b: IconPrint, shift = 1): number {
  if (a.size !== b.size) throw new Error('Отпечатки разного размера.');
  if (!a.mass || !b.mass) return 0;
  let best = 0;
  for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) best = Math.max(best, overlap(a, b, dx, dy));
  return best;
}

// ---------------------------------------------------------------------------
// Подбор
// ---------------------------------------------------------------------------

/** Пороги — по замеру на макетах Driver и Rider (docs/research/2026-10-21-icons.md). */
export const ICON_SAME = 0.9;
/** Тот же рисунок — замена без вопроса (как у копий и одноимённых): ниже уже бывали ошибки (замер, «Adress» → монета 1.00 — многоцветная). */
export const ICON_SURE = 0.97;
export const ICON_SIMILAR = 0.75;
/** Двойники: формы, отличающиеся меньше, — одна форма (состояния, размеры, дубликаты). */
export const ICON_TWIN = 0.02;
/** Другая форма ближе этого к лучшей — выбор спорный, решает дизайнер. */
export const ICON_MARGIN = 0.04;
/** Сколько ближайших без сдвига пересчитать со сдвигом. */
const SHORTLIST = 12;

export type IconMatchStatus = 'same' | 'similar' | 'none';

export interface IconMatch {
  status: IconMatchStatus;
  /** Предложенная иконка (у `none` — нет). */
  target?: IconCandidate;
  similarity: number;
  /** Спорно: двойники неразличимы или другая форма почти так же близка. */
  disputed: boolean;
  /** Ближайшие по форме — первыми в списке выбора. */
  nearest: { candidate: IconCandidate; similarity: number }[];
}

const bareName = (s: string) => (s.split('/').pop() ?? s).toLowerCase().replace(/^(ic|icon)[_\s-]+/, '').replace(/[_\s-]*\d+(px)?$/, '').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Наша иконка для рисунка из макета. Среди двойников лучшей формы — ближе по размеру рисунка, потом с тем же
 * именем; не разошлись — спорно. Одноцветной иконке макета многоцветные не предлагаем: у многоцветной цвета —
 * часть рисунка (решение PD), а силуэт у неё часто просто круг или прямоугольник (замер: «Car Class» → «ic_spasibo_color»).
 */
export function rankIcons(print: IconPrint, all: readonly IconCandidate[], hint?: { name?: string; glyph?: { width: number; height: number }; multicolor?: boolean }): IconMatch {
  const candidates = hint?.multicolor === false ? all.filter((c) => !c.multicolor) : all;
  // Быстрый отбор без сдвига, сдвиг — только для ближайших: сравнение со сдвигом в 9 раз дороже.
  const scored = candidates
    .map((candidate) => ({ candidate, similarity: iconSimilarity(print, candidate.print, 0) }))
    .sort((a, b) => b.similarity - a.similarity)
    .map((s, i) => (i < SHORTLIST ? { ...s, similarity: iconSimilarity(print, s.candidate.print) } : s))
    .sort((a, b) => b.similarity - a.similarity);
  const nearest = scored.slice(0, 5);
  const top = scored[0];
  if (!top || top.similarity < ICON_SIMILAR) return { status: 'none', similarity: top?.similarity ?? 0, disputed: false, nearest };
  const side = (g?: { width: number; height: number }) => (g ? Math.max(g.width, g.height) : 0);
  const want = hint?.name ? bareName(hint.name) : '';
  const twins = scored
    .filter((s) => s.similarity >= top.similarity - ICON_TWIN)
    .map((s) => ({ ...s, size: hint?.glyph && s.candidate.glyph ? Math.abs(side(s.candidate.glyph) - side(hint.glyph)) : 0, named: want && bareName(s.candidate.name) === want ? 0 : 1 }))
    .sort((a, b) => a.size - b.size || a.named - b.named);
  const best = twins[0];
  const tied = twins.filter((t) => Math.abs(t.size - best.size) <= 0.5 && t.named === best.named).length > 1;
  const close = scored.some((s) => s.similarity < top.similarity - ICON_TWIN && s.similarity >= top.similarity - ICON_MARGIN);
  return {
    status: top.similarity >= ICON_SAME ? 'same' : 'similar',
    target: best.candidate,
    similarity: best.similarity,
    disputed: tied || (top.similarity < ICON_SAME && close),
    nearest,
  };
}

// ---------------------------------------------------------------------------
// Хранение в индексе
// ---------------------------------------------------------------------------

// Свой base64: в песочнице плагина нет btoa/atob.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Отпечаток → строка (base64, 4 бита на клетку): 32×32 — 684 знака. */
export function packPrint(p: IconPrint): string {
  const bytes = new Uint8Array(Math.ceil(p.cells.length / 2));
  for (let k = 0; k < p.cells.length; k++) bytes[k >> 1] |= (p.cells[k] >> 4) << (k & 1 ? 0 : 4);
  let s = '';
  for (let k = 0; k < bytes.length; k += 3) {
    const n = (bytes[k] << 16) | ((bytes[k + 1] ?? 0) << 8) | (bytes[k + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (k + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (k + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

export function unpackPrint(packed: string, size = PRINT_SIZE): IconPrint {
  const bytes: number[] = [];
  for (let k = 0; k < packed.length; k += 4) {
    const v = [0, 1, 2, 3].map((j) => B64.indexOf(packed[k + j]));
    const n = (v[0] << 18) | (v[1] << 12) | (Math.max(v[2], 0) << 6) | Math.max(v[3], 0);
    bytes.push((n >> 16) & 255);
    if (v[2] >= 0) bytes.push((n >> 8) & 255);
    if (v[3] >= 0) bytes.push(n & 255);
  }
  const cells = new Uint8Array(size * size);
  let mass = 0;
  for (let k = 0; k < cells.length; k++) {
    cells[k] = (((bytes[k >> 1] ?? 0) >> (k & 1 ? 0 : 4)) & 15) * 17;
    mass += cells[k];
  }
  return { size, cells, mass };
}
