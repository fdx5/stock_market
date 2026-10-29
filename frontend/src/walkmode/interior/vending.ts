import * as THREE from "three";
import type { FacCtx } from "./facilityFurnish";
import type { Frame } from "./furnish";
import type { Room } from "./plan/types";
import * as M from "./models";
import { DRINKS, type Drink } from "./drinks";
import { DrinkAtlas } from "./drinkArtwork";
export { DRINKS, type Drink } from "./drinks";

export interface VendingSession { id: string; dispense(drink: Drink): boolean }

/** One modest machine, the shell batched with its room. Only its can moves. */
export function placeVending(c: FacCtx, room: Room, f: Frame) {
  const zone = c.zoneOf(room), { P, X } = c;
  const atlas = c.hooks.drinks ?? (c.hooks.drinks = c.own(new DrinkAtlas()));
  c.put([
    M.rb(X.accentDark, .94, 1.86, .72, .035, 0, .95, .36),
    M.bx(P.applianceDark, .78, 1.12, .025, 0, 1.12, .732),
    M.bx(P.ledWarm, .015, 1.08, .015, -.36, 1.12, .75),
    M.bx(P.ledWarm, .015, 1.08, .015, .36, 1.12, .75),
    M.rb(P.blackMetal, .64, .22, .06, .02, 0, .3, .72),
    M.bx(P.steel, .66, .02, .2, 0, .19, .71),
    ...Array.from({ length: 12 }, (_, i) => ({ m: atlas.material, g: atlas.geometry(DRINKS[i], .047, .14).translate(-.24 + (i % 4) * .16, .76 + Math.floor(i / 4) * .3, .755) })),
    ...Array.from({ length: 12 }, (_, i) => M.cy(P.steel, .046, .046, .004, -.24 + (i % 4) * .16, .832 + Math.floor(i / 4) * .3, .755, 16)),
  ], f, zone, true);
  const sign = c.signs.sign("plate", ["DRINKS", `음료 ${DRINKS.length}종 · E 선택`], .78, .19);
  c.B.add(c.signs.material, zone, sign, new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 1.78, .735)), false); sign.dispose();
  const can = new THREE.Group(), body = new THREE.Mesh(atlas.geometry(DRINKS[0]), atlas.material);
  const lidMat = c.own(new THREE.MeshStandardMaterial({ color: "#dce6ee", metalness: .8, roughness: .22 }));
  can.add(body);
  for (const y of [-.074, .074]) { const lid = new THREE.Mesh(c.own(new THREE.CylinderGeometry(.047, .047, .006, 16)), lidMat); lid.position.y = y; can.add(lid); }
  const tab = new THREE.Mesh(c.own(new THREE.TorusGeometry(.012, .003, 5, 14).rotateX(Math.PI / 2)), lidMat); tab.position.set(0, .079, .007); tab.scale.z = 1.4; can.add(tab);
  const root = new THREE.Group(); root.applyMatrix4(f.m); root.add(can); c.dynamic.add(root); can.visible = false;
  let time = -1, impact = false;
  const id = `vending-${room.id}`;
  const session: VendingSession = { id, dispense(drink) {
    if (time >= 0 || !DRINKS.some(d => d.id === drink.id)) return false;
    const picked = DRINKS.find(d => d.id === drink.id)!;
    body.geometry.dispose(); body.geometry = atlas.geometry(picked);
    time = 0; impact = false; can.visible = true; c.hooks.vendSound?.("motor"); return true;
  } };
  c.interactables.push({ id, zone, room, hit: c.hitIn(f, .92, 1.8, .15, 0, .95, .76), label: () => time >= 0 ? "음료가 나오는 중" : "음료 자판기 사용하기", act: () => { if (time < 0) c.hooks.vending?.(session); return "beep"; }, update(dt) {
    if (time < 0) return;
    time += dt;
    const fall = Math.min(1, Math.max(0, (time - .35) / .5));
    can.position.set(0, .72 - .43 * fall * fall + (time > .85 && time < 1.08 ? Math.sin((time - .85) / .23 * Math.PI) * .06 : 0), .77);
    can.rotation.z = fall * Math.PI / 2;
    if (fall === 1 && !impact) { impact = true; c.hooks.vendSound?.("drop"); }
    if (time >= 3.6) { time = -1; can.visible = false; }
  } });
  // Replaced can geometry belongs to this one moving mesh, not an ever-growing list per drink.
  c.own({ dispose: () => body.geometry.dispose() });
}
