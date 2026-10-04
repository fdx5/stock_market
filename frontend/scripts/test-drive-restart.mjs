import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/ComplexHologram.tsx', import.meta.url), 'utf8');
const delivery = source.slice(source.indexOf('  const startDelivery ='), source.indexOf('  useEffect(() => {', source.indexOf('  const startDelivery =')));
const reset = source.slice(source.indexOf('  const resetVehicle ='), source.indexOf('  // The score board:', source.indexOf('  const resetVehicle =')));
const tank = source.match(/const tankFor = .*?;/)[0];
const script = ts.transpile(`${tank}\n${delivery}\n${reset}\nreturn resetVehicle;`, { target: ts.ScriptTarget.ES2020 });

for (const home of [false, true]) {
  for (const capacity of [0, 900]) {
    test(`restart refuels with no delivery candidates (home=${home}, capacity=${capacity})`, () => {
      const car = { hide: true, speed: 0 };
      const dv = { fuel: 0, fuelCap: capacity, dryAt: 1234, dead: true, hp: 0,
        sim: { steer: 1 }, feel: { hpWarn: 2, fuelWarn: 2 }, fx: { clear() {} },
        game: { done: true }, home: { x: 1, y: 2, hx: 1, hy: 0 } };
      let fuelOut = true, wrecked = 'fuel', delivery = 'old', summoned = 0;
      const st = { drive: dv, traffic: { hero: () => car, drive() {}, summon() { summoned++; } } };
      const deps = { stageRef: { current: st }, signsRef: { current: [] }, lastDest: { current: 'old' },
        dataRef: { current: null }, drivePool: { current: new Map() },
        endDelivery: d => { d.game = null; }, setResult() {}, setKnocks() {},
        setDelivery: v => { delivery = v; }, setFuelOut: v => { fuelOut = v; },
        setHpWarn() {}, setFuelWarn() {}, paintDamage() {}, setHp() {},
        setWrecked: v => { wrecked = v; }, setDriving() {}, setGoldSum() {}, addGold() {}, goldTotal: () => 100 };
      const restart = new Function(...Object.keys(deps), script)(...Object.values(deps));
      // A route-less restart previously left fuel=0 and immediately exploded again.
      for (let attempt = 0; attempt < 2; attempt++) {
        dv.fuel = 0; dv.dryAt = 1234; dv.dead = true; fuelOut = true;
        restart(home);
        assert.equal(dv.fuel, Math.max(capacity, 250));
        assert.equal(dv.fuel, dv.fuelCap);
        assert.equal(dv.dryAt, 0);
        assert.equal(fuelOut, false);
        assert.equal(dv.dead, false);
        assert.equal(dv.hp, 100);
        assert.equal(wrecked, null);
        assert.equal(delivery, null);
        assert.equal(car.hide, false);
      }
      assert.equal(summoned, home ? 2 : 0);
    });
  }
}
