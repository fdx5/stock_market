import assert from 'node:assert/strict';
import { ENTRANCE_SPEC, entranceBoxes, entranceKind, inRing, placeEntrance, type EntranceKind } from '../src/components/droneEntrances';

// Every building the walker can reach has a way in: an entrance on its outline facing the street,
// sized by what it is, drawn outside its wall, and reachable from the pavement.
type Ring = [number, number][];
const rect = (x: number, y: number, w: number, d: number, a = 0): Ring => {
  const c = Math.cos(a), s = Math.sin(a);
  return ([[0, 0], [w, 0], [w, d], [0, d]] as Ring).map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
};
const shapes: Record<string, Ring> = {
  box: rect(0, 0, 30, 18), rotated: rect(0, 0, 26, 14, 0.6), tiny: rect(0, 0, 9, 11), huge: rect(0, 0, 140, 90),
  L: [[0, 0], [40, 0], [40, 12], [14, 12], [14, 36], [0, 36]], U: [[0, 0], [50, 0], [50, 40], [36, 40], [36, 14], [14, 14], [14, 40], [0, 40]],
  tri: [[0, 0], [30, 0], [10, 25]], clockwise: rect(0, 0, 20, 12).reverse() as Ring,
};
const flat = () => 12;
const onBoundary = (x: number, y: number, r: Ring) => r.some((a, i) => { const b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < 1e-6; });
const centre = (r: Ring): [number, number] => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];
const kinds = Object.keys(ENTRANCE_SPEC) as EntranceKind[];
let checked = 0;
for (const [name, ring] of Object.entries(shapes)) for (const kind of kinds) for (const side of [0, 1, 2, 3, -1]) {
  const [cx, cy] = centre(ring), far = 200, a = side * Math.PI / 2;
  const toward: [number, number] | null = side < 0 ? null : [cx + Math.cos(a) * far, cy + Math.sin(a) * far];
  const e = placeEntrance(ring, kind, toward, flat, name);
  assert.ok(e, `${name}/${kind}: an entrance`);
  assert.ok(onBoundary(e!.x, e!.y, ring), `${name}/${kind}: on the wall`);
  assert.ok(!inRing(e!.x + e!.nx * 0.6, e!.y + e!.ny * 0.6, ring), `${name}/${kind}: normal points out`);
  assert.ok(e!.w >= 0.9 && e!.h >= 2, `${name}/${kind}: a door a person fits through`);
  if (toward && name !== 'tri') assert.ok(((toward[0] - e!.x) * e!.nx + (toward[1] - e!.y) * e!.ny) > 0, `${name}/${kind}/side ${side}: faces the street`);
  for (const [part, , up, out, , sy, so] of entranceBoxes(e!)) {
    assert.ok(out - so / 2 > -0.06, `${name}/${kind}: ${part} stands outside the wall`);
    assert.ok(up - sy / 2 > -0.01, `${name}/${kind}: ${part} not under the ground`);
  }
  checked++;
}
// Size by what the building is (same outline): a house's door < a block of flats' < public buildings'
const base = shapes.huge, w = (k: EntranceKind) => placeEntrance(base, k, [70, -100], flat)!.w;
assert.ok(w('house') < w('apartment') && w('apartment') < w('office') && w('office') < w('store'), 'door widths rise with the building type');
assert.ok(w('hospital') > w('school') && w('museum') > w('apartment') && w('civic') > w('shop'), 'public buildings have wider entrances');
assert.ok(placeEntrance(shapes.huge, 'office', [70, -100], flat)!.w > placeEntrance(rect(0, 0, 22, 18), 'office', [11, -100], flat)!.w, 'a larger building of a kind a wider entrance');
// What the buildings are, from the map's names and their size
const k = (names: [string, string][], area = 3000, h = 30) => entranceKind(names.map(([name, kind]) => ({ name, kind })), area, h);
assert.equal(k([['삼성서울병원', 'hospital']]), 'hospital');
assert.equal(k([['서울특별시청', 'gov']]), 'civic');
assert.equal(k([['국립중앙박물관', 'major']]), 'museum');
assert.equal(k([['현대백화점 무역센터점', 'commercial']]), 'store');
assert.equal(k([['서울대치초등학교', 'school']]), 'school');
assert.equal(k([['래미안대치팰리스 101동', 'apt']], 900, 70), 'apartment');
assert.equal(k([['강남역', 'subway']]), 'station');
assert.equal(k([], 120, 7), 'house');
assert.equal(k([], 1500, 120), 'office');
assert.equal(entranceKind([], 900, 60, { aptNear: true }), 'apartment', 'an unnamed block among apartment labels');
assert.equal(entranceKind([], 800, 45, { slender: 3.4 }), 'apartment', 'a tall narrow slab');
assert.equal(entranceKind([{ name: '삼성서울병원', kind: 'hospital' }], 3000, 50, { aptNear: true }), 'hospital', 'a named hospital stays one');
// Reachable from the street: a block of buildings with 8 m streets between them; each entrance's
// approach (1.5 m out) lies in a street, never in another building
const block: Ring[] = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) block.push(rect(i * 38, j * 30, 30, 22));
for (const ring of block) {
  const [cx, cy] = centre(ring), street: [number, number] = [cx, Math.floor(cy / 30) * 30 - 4];
  const e = placeEntrance(ring, 'shop', street, flat)!, ax = e.x + e.nx * 1.5, ay = e.y + e.ny * 1.5;
  assert.ok(!block.some(r => inRing(ax, ay, r)), 'the approach is in the street');
  checked++;
}
console.log(`building entrances: ${checked} placements on the wall facing the street, outside it, sized by type (${kinds.length} kinds), names classified, approaches reachable PASS`);
