import assert from "node:assert/strict";
import {mendAccess, planAccess, privateOpensToDoors} from "../src/walkmode/interior/plan/planAccess";
import type {FloorPlan, Opening, Room} from "../src/walkmode/interior/plan/types";

// a hall with a bedroom read "open" to it (dropped by the wall resolver: a private room never
// stands open), a bathroom with no door read at all, a balcony behind the bedroom's window only
const rooms: Room[] = [
  {id: "ent", type: "entrance", label: "현관", zone: "e", rect: [0, 0, 1.6, 1.6]},
  {id: "hall", type: "hall", surfaceType: "living", label: "거실", zone: "l", rect: [1.6, 0, 6, 1.4]},
  {id: "liv", type: "living", label: "거실", zone: "l", rect: [1.6, 1.4, 6, 5]},
  {id: "bed", type: "bedroom", label: "침실", zone: "b", rect: [6, 0, 9, 3]},
  {id: "bath", type: "bathroom", label: "욕실", zone: "w", rect: [0, 1.6, 1.6, 3.4]},
  {id: "bal", type: "balcony", label: "발코니", zone: "k", rect: [9, 0, 10.4, 3]},
];
const ops: Opening[] = [
  {type: "front_door", a: "ent", b: "out", axis: "z", at: 0, center: .8, width: .9, height: 2.1, sill: 0},
  {type: "open", a: "ent", b: "hall", axis: "x", at: 1.6, center: .7, width: 1.2, height: 2.4, sill: 0},
  {type: "open", a: "hall", b: "liv", axis: "z", at: 1.4, center: 3.8, width: 4.4, height: 2.4, sill: 0},
  {type: "open", a: "hall", b: "bed", axis: "x", at: 6, center: .7, width: 1.3, height: 2.4, sill: 0},
  {type: "window", a: "bed", b: "bal", axis: "x", at: 9, center: 1.5, width: 2.8, height: 1.6, sill: .5},
];
const conv = privateOpensToDoors(rooms, ops);
assert.equal(conv.doors, 1, "the open read into the bedroom is its door");
const d = conv.openings.find(o => o.b === "bed")!;
assert.equal(d.type, "door"); assert.ok(d.width <= .9 + 1e-9);
const plan = {rooms, openings: [...ops], bounds: [0, 0, 10.4, 5], imageAnalysis: {wallThicknessMetres: .12}} as unknown as FloorPlan;
const before = planAccess(plan).blocked.map(b => b.id).sort();
assert.deepEqual(before, ["bal", "bath", "bed"], "bedroom (its open dropped), bathroom and balcony sealed");
const n = mendAccess(plan);
assert.equal(planAccess(plan).blocked.length, 0, "every room reachable after mending");
assert.ok(n >= 3);
const bathDoor = plan.openings.find(o => o.a === "bath" || o.b === "bath")!;
assert.equal(bathDoor.type, "door"); assert.ok(bathDoor.width <= .8 + 1e-9, "a bathroom's door is a bathroom door");
const bal = plan.openings.find(o => (o.a === "bal" || o.b === "bal") && o.type !== "window");
assert.ok(bal && ["glass_door", "door"].includes(bal.type), "the balcony reached through a door in its window wall");
console.log("plan access ok", plan.openings.filter(o => !ops.includes(o)).map(o => `${o.type}:${o.a}-${o.b}`));
