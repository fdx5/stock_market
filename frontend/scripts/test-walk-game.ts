import assert from 'node:assert/strict';
import { surveyMatches, type SurveyBuilding } from '../src/walkmode/building/survey';
import { shopOf, SHOP_ITEMS } from '../src/walkmode/interior/shop';
import { GARAGE_BIKES, GARAGE_CARS } from '../src/walkmode/game/garage';
// (the traffic's models, sceneCars CAR_SPECS — that module needs the page's env to import)
const CAR_SPECS: Record<string, true> = Object.fromEntries(['sedan', 'sedan-sports', 'suv', 'suv-luxury', 'hatchback-sports', 'van', 'sedan-large', 'suv-small', 'kei-box', 'mpv', 'pickup', 'taxi', 'boxtruck', 'cargo', 'bus'].map(k => [k, true]));

// The external drawing is used only for the building it overlaps: a neighbour's is refused.
const foot: [number, number][] = [[0, 0], [60, 0], [60, 40], [0, 40]];
const survey = (w = 60, d = 40): SurveyBuilding => ({ status: 'available', year: 2024, frame: { x: 1000, y: 2000, lon: 127, lat: 37.5, width: w, depth: d },
  outlines: [[[[1000, 2000], [1000 + w, 2000], [1000 + w, 2000 + d], [1000, 2000 + d]]]] as unknown as SurveyBuilding['outlines'] });
assert.equal(surveyMatches(survey(), foot, [0, 0]), true, 'the same outline matches');
assert.equal(surveyMatches(survey(30, 20), foot, [10, 10]), true, 'a block inside the footprint matches');
assert.equal(surveyMatches(survey(), foot, [120, 0]), false, 'the building next door is refused');
assert.equal(surveyMatches(survey(), foot, [45, 30]), false, 'a small corner overlap is refused');
assert.equal(surveyMatches({ status: 'available', year: 2024 }, foot, [0, 0]), false, 'no frame, no match');

// Counters that sell, and those that do not
assert.equal(shopOf('편의점', 'clinic', 'clerk'), 'convenience');
assert.equal(shopOf('카페 2', 'office', 'clerk'), 'cafe');
assert.equal(shopOf('1층 약국', 'clinic', 'clerk'), 'pharmacy');
assert.equal(shopOf('구내식당', 'office', 'cook'), 'food');
assert.equal(shopOf('원무과', 'clinic', 'clerk'), null);
assert.equal(shopOf('복도', 'clinic', 'visitor'), null);
for (const [k, items] of Object.entries(SHOP_ITEMS)) { assert.ok(items.length >= 6, `${k}: a choice`); for (const i of items) { assert.ok(i.price > 0 && Number.isInteger(i.price)); assert.ok(i.kind === 'goods' || i.how, `${i.name}: how it is had`); } }

// The garage: dozens of cars, each drawn with a model the traffic has
assert.ok(GARAGE_CARS.length >= 30, `${GARAGE_CARS.length} cars`);
assert.equal(new Set(GARAGE_CARS.map(c => c.id)).size, GARAGE_CARS.length, 'unique ids');
for (const c of GARAGE_CARS) { assert.ok(CAR_SPECS[c.kind], `${c.name}: model ${c.kind}`); assert.ok(c.top >= 100 && c.top <= 260 && (c.size || ['boxtruck', 'cargo', 'bus'].indexOf(c.kind) < 0) && c.pull >= 0.5 && c.pull < 2); }
assert.ok(GARAGE_BIKES.length >= 6 && GARAGE_BIKES.every(b => b.top > 5 && b.top <= 100 / 3.6 + 1e-9));
console.log(`walk game: drawing consistency gate, ${Object.keys(SHOP_ITEMS).length} shop kinds, ${GARAGE_CARS.length} cars and ${GARAGE_BIKES.length} bicycles PASS`);
