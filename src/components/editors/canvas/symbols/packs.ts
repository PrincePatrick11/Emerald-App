import { circle, corners, join, lens, line, poly, polar, spiral, starPolygon } from './paths';
import { num } from '../svg';

/**
 * The symbols that come with the app, drawn for it as centre lines in a box
 * of 100 × 100 (see `paths.ts`). A pack is a named list; a symbol's id is
 * `pack.name`, its name the translation `symbols.<pack>.<name>`. Other packs
 * can join the list in the same shape.
 */
export interface SymbolDef {
  /** `pack.name`, unique. */
  id: string;
  /** Path data in the 100 × 100 box. */
  d: string;
  /** Parts filled in the line colour (a dot, a disc), drawn under the lines. */
  solid?: string;
  /** The line weight a new one starts with, for a dense symbol thinner than the usual. */
  weight?: number;
  /** Its own name, for a symbol that is not translated (one of the place's own). */
  name?: string;
}

export interface SymbolPack {
  id: string;
  symbols: SymbolDef[];
}

/** A triangle pointing up or down, with a bar across for air and earth. */
const triangleUp = poly([[50, 14], [88, 80], [12, 80]], true);
const triangleDown = poly([[50, 86], [88, 20], [12, 20]], true);

const sun = { d: circle(50, 50, 34), solid: circle(50, 50, 6) };
const moon = 'M62 12A40 40 0 1 0 62 88A44 44 0 0 1 62 12Z';
const mercury = join(circle(50, 48, 16), 'M32 12C34 28 66 28 68 12', line(50, 64, 50, 92), line(38, 80, 62, 80));
const venus = join(circle(50, 36, 22), line(50, 58, 50, 90), line(34, 75, 66, 75));
const mars = join(circle(42, 58, 24), line(59, 41, 84, 16), poly([[62, 16], [84, 16], [84, 38]]));
const jupiter = join('M22 40C22 22 42 18 46 32C50 46 38 60 20 66L84 66', line(66, 18, 66, 90));
const saturn = join(line(24, 22, 48, 22), line(36, 10, 36, 66), 'M36 44C44 30 66 32 66 48C66 62 50 70 54 82C56 88 64 90 70 84');

/** Eight arrows out of a circle: the chaos star. */
const chaosStar = { solid: circle(50, 50, 10), d: join(...Array.from({ length: 8 }, (_, i) => {
  const deg = i * 45;
  const [x1, y1] = polar(50, 50, 9, deg);
  const [x2, y2] = polar(50, 50, 44, deg);
  return join(line(x1, y1, x2, y2), poly([polar(50, 50, 34, deg - 8), [x2, y2], polar(50, 50, 34, deg + 8)]));
})) };

/** The helm of awe: eight arms out of a circle, each with a bar across and a fork at its end. */
const helmOfAwe = join(circle(50, 50, 8), ...Array.from({ length: 8 }, (_, i) => {
  const deg = i * 45;
  const at = (r: number, side: number) => polar(50, 50, Math.hypot(r, side), deg + (Math.atan2(side, r) * 180) / Math.PI);
  return join(
    poly([polar(50, 50, 8, deg), polar(50, 50, 44, deg)]),
    poly([at(24, -6), at(24, 6)]),
    poly([at(44, -7), at(36, -7), at(36, 7), at(44, 7)]),
  );
}));

/** Three triangles, each through the others, on a small circle. */
const valknut = join(...[0, 120, 240].map((deg) => {
  const [cx, cy] = polar(50, 56, 13, deg + 180);
  return poly(corners(3, cx, cy, 32), true);
}));

/** The unicursal hexagram: one line through the six points, an X where the hexagram has its two bars. */
const unicursal = (() => {
  const [top, ur, lr, bottom, ll, ul] = corners(6, 50, 50, 42);
  return poly([ul, bottom, ur, ll, top, lr, ul]);
})();

/**
 * An ogham letter on its stem: `count` strokes to the right, to the left,
 * slanting across, or short notches across, as the four groups have them.
 */
function ogham(kind: 'right' | 'left' | 'slant' | 'notch', count: number): string {
  const strokes = Array.from({ length: count }, (_, i) => {
    const y = 50 + (i - (count - 1) / 2) * 13;
    if (kind === 'right') return line(50, y, 76, y);
    if (kind === 'left') return line(24, y, 50, y);
    if (kind === 'slant') return line(32, y + 7, 68, y - 7);
    return line(42, y, 58, y);
  });
  return join(line(50, 4, 50, 96), ...strokes);
}

/** Lines between circles, from edge to edge rather than centre to centre. */
function linked(points: readonly (readonly [number, number])[], r: number, pairs: readonly (readonly [number, number])[]): string {
  return join(...pairs.map(([a, b]) => {
    const [x1, y1] = points[a], [x2, y2] = points[b];
    const d = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / d, uy = (y2 - y1) / d;
    return line(x1 + ux * r, y1 + uy * r, x2 - ux * r, y2 - uy * r);
  }));
}

/** The tree of life: the ten sephiroth and the 22 paths between them. */
const SEPHIROTH: [number, number][] = [[50, 7], [76, 21], [24, 21], [76, 45], [24, 45], [50, 55], [76, 71], [24, 71], [50, 81], [50, 94]];
const treeOfLife = join(
  ...SEPHIROTH.map(([x, y]) => circle(x, y, 5)),
  linked(SEPHIROTH, 5, [[0, 1], [0, 2], [0, 5], [1, 2], [1, 5], [1, 3], [2, 5], [2, 4], [3, 4], [3, 5], [3, 6], [4, 5], [4, 7], [5, 6], [5, 8], [5, 7], [6, 7], [6, 8], [6, 9], [7, 8], [7, 9], [8, 9]]),
);

/** Circles of radius `r` round the centre and on the corners of hexagons out to `rings` rings. */
function lifeCircles(r: number, rings: number): string {
  const centres: [number, number][] = [[50, 50]];
  for (let ring = 1; ring <= rings; ring++) {
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        const [ax, ay] = polar(50, 50, r * ring, side * 60);
        const [bx, by] = polar(50, 50, r * ring, (side + 1) * 60);
        centres.push([ax + ((bx - ax) * step) / ring, ay + ((by - ay) * step) / ring]);
      }
    }
  }
  return join(...centres.map(([x, y]) => circle(x, y, r)));
}

/** Metatron's cube: thirteen circles and every line between their centres. */
const metatron = (() => {
  const pts: [number, number][] = [[50, 50], ...corners(6, 50, 50, 20, 0), ...corners(6, 50, 50, 40, 0)];
  const pairs: [number, number][] = [];
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) pairs.push([a, b]);
  return join(...pts.map(([x, y]) => circle(x, y, 9)), linked(pts, 0, pairs));
})();

/** The triskele: three spirals round arm centres on a small circle, each ending in the middle. */
const triskele = join(...[0, 120, 240].map((deg) => {
  const [cx, cy] = polar(50, 52, 24, deg);
  const turns = 1.5;
  // The spiral ends pointing at the middle, so the arms meet there.
  const end = (Math.atan2(52 - cy, 50 - cx) * 180) / Math.PI + 90;
  const steps = 48;
  const pts = Array.from({ length: steps + 1 }, (_, i) => polar(cx, cy, (22 * i) / steps, end - (1 - i / steps) * turns * 360));
  return poly([...pts, [50, 52]]);
}));

/** The ouroboros: a serpent round a circle, its head at the top biting its tail. */
const ouroboros = {
  d: join(
    `M${polar(50, 52, 36, 18).join(' ')}A36 36 0 1 1 ${polar(50, 52, 36, 326).join(' ')}`,
    `M${polar(50, 52, 28, 18).join(' ')}A28 28 0 1 1 ${polar(50, 52, 28, 330).join(' ')}`,
    head(),
  ),
  solid: circle(...polar(50, 52, 34, 342), 2.5),
};

/** The ouroboros's head: an oval along the circle, just before the tail. */
function head(): string {
  const at = 339;
  const [cx, cy] = polar(50, 52, 32, at);
  // Along the circle there, the head's long axis.
  const ux = Math.cos((at * Math.PI) / 180), uy = Math.sin((at * Math.PI) / 180);
  const [x1, y1] = [cx - ux * 11, cy - uy * 11];
  const [x2, y2] = [cx + ux * 11, cy + uy * 11];
  return `M${num(x1)} ${num(y1)}A11 8 ${at} 0 1 ${num(x2)} ${num(y2)}A11 8 ${at} 0 1 ${num(x1)} ${num(y1)}Z`;
}

/** The caduceus: a winged staff with two serpents wound round it. */
const caduceus = (() => {
  const serpent = (phase: number) => poly(Array.from({ length: 41 }, (_, i) => {
    const y = 34 + i * 1.3;
    return [50 + Math.cos((i / 40) * Math.PI * 3 + phase) * 15 * (1 - i / 70), y] as [number, number];
  }));
  return join(
    line(50, 10, 50, 94),
    'M50 22C42 12 26 10 12 16C24 22 36 26 50 28', 'M50 22C58 12 74 10 88 16C76 22 64 26 50 28',
    serpent(0), serpent(Math.PI),
    circle(68, 31, 4), circle(32, 31, 4),
  );
})();

const pack = (id: string, entries: Record<string, string | Omit<SymbolDef, 'id'>>): SymbolPack => ({
  id,
  symbols: Object.entries(entries).map(([name, s]) => ({ id: `${id}.${name}`, ...(typeof s === 'string' ? { d: s } : s) })),
});

export const SYMBOL_PACKS: SymbolPack[] = [
  pack('planets', {
    sun,
    moon,
    mercury,
    venus,
    earth: join(circle(50, 50, 34), line(50, 16, 50, 84), line(16, 50, 84, 50)),
    mars,
    jupiter,
    saturn,
    uranus: join(line(24, 14, 24, 60), line(76, 14, 76, 60), line(24, 38, 76, 38), line(50, 14, 50, 66), circle(50, 78, 10)),
    neptune: join('M22 20C22 56 78 56 78 20', line(50, 12, 50, 90), line(34, 74, 66, 74), poly([[14, 28], [22, 20], [30, 28]]), poly([[42, 20], [50, 12], [58, 20]]), poly([[70, 28], [78, 20], [86, 28]])),
    pluto: join(circle(50, 28, 12), 'M24 20C24 56 76 56 76 20', line(50, 48, 50, 90), line(36, 74, 64, 74)),
    northNode: join('M30 70C12 50 22 18 50 18C78 18 88 50 70 70', circle(26, 76, 7), circle(74, 76, 7)),
    southNode: join('M30 30C12 50 22 82 50 82C78 82 88 50 70 30', circle(26, 24, 7), circle(74, 24, 7)),
  }),
  pack('zodiac', {
    aries: 'M50 86L50 38C50 18 38 12 30 14C20 17 16 28 22 36M50 38C50 18 62 12 70 14C80 17 84 28 78 36',
    taurus: join(circle(50, 64, 22), 'M16 18C24 38 38 42 50 42C62 42 76 38 84 18'),
    gemini: join('M20 16Q50 30 80 16', 'M20 84Q50 70 80 84', line(38, 24, 38, 76), line(62, 24, 62, 76)),
    cancer: join(circle(30, 38, 9), 'M30 29C50 22 72 22 88 32', circle(70, 62, 9), 'M70 71C50 78 28 78 12 68'),
    leo: join(circle(32, 60, 13), 'M44 54C44 30 50 16 64 16C78 16 82 32 72 48C64 60 64 74 74 82C80 86 86 82 88 76'),
    virgo: join(line(14, 26, 14, 80), 'M14 36C14 24 32 24 32 36L32 80', 'M32 36C32 24 50 24 50 36L50 80', 'M50 36C50 24 66 24 66 36L66 72C66 84 76 84 80 74C84 64 76 58 70 66C64 74 62 84 56 90'),
    libra: join(line(14, 80, 86, 80), 'M14 62L36 62C26 50 32 30 50 30C68 30 74 50 64 62L86 62'),
    scorpio: join(line(12, 26, 12, 72), 'M12 36C12 24 30 24 30 36L30 72', 'M30 36C30 24 48 24 48 36L48 70C48 82 58 84 70 76L84 66', poly([[72, 64], [84, 66], [82, 78]])),
    sagittarius: join(line(18, 82, 82, 18), poly([[52, 18], [82, 18], [82, 48]]), line(30, 46, 54, 70)),
    capricorn: 'M12 22C22 22 26 32 28 42L34 78L48 30C52 20 62 22 62 34L62 60C62 80 84 82 86 66C88 52 70 50 62 64C58 74 52 84 40 88',
    aquarius: join(poly([[10, 42], [25, 30], [40, 42], [55, 30], [70, 42], [85, 30], [92, 36]]), poly([[10, 68], [25, 56], [40, 68], [55, 56], [70, 68], [85, 56], [92, 62]])),
    pisces: join('M26 14C46 34 46 66 26 86', 'M74 14C54 34 54 66 74 86', line(22, 50, 78, 50)),
    conjunction: join(circle(40, 60, 20), line(54, 46, 82, 18)),
    opposition: join(circle(24, 76, 12), circle(76, 24, 12), line(32, 68, 68, 32)),
    trine: triangleUp,
    square: poly([[18, 18], [82, 18], [82, 82], [18, 82]], true),
    sextile: join(line(50, 12, 50, 88), line(17, 31, 83, 69), line(17, 69, 83, 31)),
  }),
  pack('alchemy', {
    fire: triangleUp,
    water: triangleDown,
    air: join(triangleUp, line(26, 56, 74, 56)),
    earth: join(triangleDown, line(26, 44, 74, 44)),
    salt: join(circle(50, 50, 34), line(16, 50, 84, 50)),
    sulfur: join(poly([[50, 10], [78, 52], [22, 52]], true), line(50, 52, 50, 92), line(34, 72, 66, 72)),
    mercury,
    gold: sun,
    silver: moon,
    copper: venus,
    iron: mars,
    tin: jupiter,
    lead: saturn,
    antimony: join(circle(50, 62, 26), line(50, 36, 50, 8), line(38, 20, 62, 20)),
    // The circle, the triangle in it, the square standing in the triangle, and the circle in the square.
    philosophersStone: join(circle(50, 50, 44), poly(corners(3, 50, 50, 44), true), poly([[32.3, 36.6], [67.7, 36.6], [67.7, 72], [32.3, 72]], true), circle(50, 54.3, 17.7)),
  }),
  pack('runes', {
    fehu: join(line(38, 10, 38, 90), line(38, 32, 66, 14), line(38, 52, 66, 34)),
    uruz: poly([[32, 90], [32, 12], [66, 32], [66, 90]]),
    thurisaz: join(line(36, 10, 36, 90), poly([[36, 30], [64, 50], [36, 70]])),
    ansuz: join(line(38, 10, 38, 90), line(38, 12, 66, 30), line(38, 32, 66, 50)),
    raidho: join(line(34, 10, 34, 90), poly([[34, 12], [64, 30], [34, 48], [66, 90]])),
    kenaz: poly([[64, 18], [34, 50], [64, 82]]),
    gebo: join(line(24, 14, 76, 86), line(76, 14, 24, 86)),
    wunjo: join(line(36, 10, 36, 90), poly([[36, 12], [64, 32], [36, 52]])),
    hagalaz: join(line(30, 10, 30, 90), line(70, 10, 70, 90), line(30, 38, 70, 62)),
    naudiz: join(line(50, 10, 50, 90), line(34, 34, 66, 58)),
    isa: line(50, 10, 50, 90),
    jera: join(poly([[44, 18], [26, 36], [44, 54]]), poly([[56, 46], [74, 64], [56, 82]])),
    eihwaz: join(line(50, 10, 50, 90), line(50, 11, 68, 29), line(50, 89, 32, 71)),
    perthro: join(line(30, 10, 30, 90), poly([[30, 10], [58, 28], [70, 16]]), poly([[30, 90], [58, 72], [70, 84]])),
    algiz: join(line(50, 10, 50, 90), line(50, 44, 26, 18), line(50, 44, 74, 18)),
    sowilo: poly([[60, 10], [36, 40], [64, 60], [40, 90]]),
    tiwaz: join(line(50, 10, 50, 90), poly([[26, 36], [50, 10], [74, 36]])),
    berkano: join(line(34, 10, 34, 90), poly([[34, 10], [64, 30], [34, 50], [64, 70], [34, 90]])),
    ehwaz: poly([[28, 90], [28, 10], [50, 32], [72, 10], [72, 90]]),
    mannaz: join(poly([[28, 90], [28, 10], [72, 46]]), poly([[72, 90], [72, 10], [28, 46]])),
    laguz: join(line(38, 10, 38, 90), line(38, 12, 64, 32)),
    ingwaz: poly([[50, 22], [76, 50], [50, 78], [24, 50]], true),
    dagaz: poly([[22, 14], [22, 86], [78, 14], [78, 86]], true),
    othala: join(poly([[28, 86], [74, 38], [50, 12], [26, 38], [72, 86]])),
  }),
  pack('occult', {
    chaosStar,
    invertedPentagram: starPolygon(5, 2, 50, 46, 42, 180),
    unicursalHexagram: unicursal,
    septagram: starPolygon(7, 2, 50, 52, 42),
    tripleMoon: join('M36 30A20 20 0 1 0 36 70A26 26 0 0 1 36 30Z', circle(50, 50, 10), 'M64 30A20 20 0 1 1 64 70A26 26 0 0 0 64 30Z'),
    triquetra: join(...[0, 120, 240].map((deg) => lens(50, 56, ...polar(50, 56, 40, deg), 0.8))),
    triquetraInCircle: join(circle(50, 56, 26), ...[0, 120, 240].map((deg) => lens(50, 56, ...polar(50, 56, 40, deg), 0.8))),
    leviathanCross: join('M50 76C38 64 18 64 18 76C18 88 38 88 50 76C62 64 82 64 82 76C82 88 62 88 50 76', line(50, 76, 50, 8), line(34, 22, 66, 22), line(26, 42, 74, 42)),
    lemniscate: 'M50 50C38 34 12 34 12 50C12 66 38 66 50 50C62 34 88 34 88 50C88 66 62 66 50 50',
    eyeOfHorus: join('M12 42Q50 16 86 40', 'M12 42Q48 60 80 44', circle(48, 38, 9), 'M16 26Q50 6 88 22', line(40, 54, 34, 86), 'M60 54C62 72 76 80 84 70C90 62 82 54 74 62'),
    valknut,
    helmOfAwe,
    mjolnir: join(circle(50, 10, 5), line(50, 15, 50, 44), poly([[18, 44], [82, 44], [82, 56], [60, 62], [55, 90], [45, 90], [40, 62], [18, 56]], true)),
    spiral: spiral(50, 50, 42, 3),
    triskele,
    ouroboros,
    witchesKnot: join(circle(50, 50, 22), ...[45, 135, 225, 315].map((deg) => lens(50, 50, ...polar(50, 50, 46, deg), 0.75))),
    caduceus,
  }),
  pack('ogham', {
    beith: ogham('right', 1), luis: ogham('right', 2), fearn: ogham('right', 3), sail: ogham('right', 4), nion: ogham('right', 5),
    uath: ogham('left', 1), dair: ogham('left', 2), tinne: ogham('left', 3), coll: ogham('left', 4), ceirt: ogham('left', 5),
    muin: ogham('slant', 1), gort: ogham('slant', 2), ngeadal: ogham('slant', 3), straif: ogham('slant', 4), ruis: ogham('slant', 5),
    ailm: ogham('notch', 1), onn: ogham('notch', 2), ur: ogham('notch', 3), eadhadh: ogham('notch', 4), iodhadh: ogham('notch', 5),
  }),
  pack('geometry', {
    pentagram: starPolygon(5, 2, 50, 54, 42),
    pentacle: join(circle(50, 50, 44), starPolygon(5, 2, 50, 50, 44)),
    hexagram: starPolygon(6, 2, 50, 50, 42),
    sealOfSolomon: join(circle(50, 50, 44), starPolygon(6, 2, 50, 50, 44)),
    heptagram: starPolygon(7, 3, 50, 52, 42),
    octagram: starPolygon(8, 3, 50, 50, 42),
    triangleInCircle: join(circle(50, 50, 42), poly(corners(3, 50, 50, 42), true)),
    vesicaPiscis: join(circle(38, 50, 26), circle(62, 50, 26)),
    circumpunct: { d: circle(50, 50, 36), solid: circle(50, 50, 6) },
    solarCross: join(circle(50, 50, 36), line(50, 14, 50, 86), line(14, 50, 86, 50)),
    ankh: join('M50 44C34 44 32 10 50 10C68 10 66 44 50 44Z', line(50, 44, 50, 90), line(26, 52, 74, 52)),
    monad: { d: join('M32 10C36 24 64 24 68 10', circle(50, 36, 14), line(50, 50, 50, 80), line(34, 64, 66, 64), 'M50 80C46 92 34 92 32 82', 'M50 80C54 92 66 92 68 82'), solid: circle(50, 36, 4) },
    treeOfLife: { d: treeOfLife, weight: 3 },
    seedOfLife: { d: join(circle(50, 50, 38), lifeCircles(19, 1)), weight: 3 },
    flowerOfLife: { d: join(circle(50, 50, 44), lifeCircles(14.5, 2)), weight: 2 },
    metatronsCube: { d: metatron, weight: 1 },
    eye: { d: join(poly(corners(3, 50, 58, 42), true), 'M30 64Q50 48 70 64Q50 80 30 64Z'), solid: circle(50, 64, 6) },
  }),
];

/** Every symbol by its id. */
export const SYMBOLS_BY_ID: ReadonlyMap<string, SymbolDef> = new Map(SYMBOL_PACKS.flatMap((p) => p.symbols.map((s) => [s.id, s])));
