import * as THREE from "three";
import { SPECS, type VehicleName } from "./physics";

/** The driver's view from inside: dashboard, instrument hood, A-pillars, the roof's edge, the
 * steering wheel (turning with the front wheels), mirrors; in the vehicle's frame (+z forward,
 * +x the left, y up from the road). */
export function cockpit(name: VehicleName) {
  const s = SPECS[name], [ex, ey, ez] = s.eye, truck = name === "coupang";
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: truck ? "#2b2e33" : "#1d1f22", roughness: 0.8, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: truck ? "#d9dadb" : "#8d9298", roughness: truck ? 0.5 : 0.35, metalness: truck ? 0.1 : 0.75 });
  const soft = new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.95 });
  const glow = new THREE.MeshStandardMaterial({ color: "#000000", emissive: truck ? "#7fd0ff" : "#dfe9f5", emissiveIntensity: 0.9, roughness: 0.4 });
  const mats = [dark, trim, soft, glow];
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z); me.rotation.set(rx, ry, rz); group.add(me); return me;
  };
  const W = truck ? 1.86 : 2.0;
  // dashboard: a deep shelf under the windscreen, from door to door
  const dashZ = ez + (truck ? 0.62 : 0.78), dashY = ey - (truck ? 0.48 : 0.42);
  box(W - 0.08, 0.1, 0.62, dark, 0, dashY, dashZ, truck ? -0.04 : -0.08);
  box(W - 0.08, 0.42, 0.1, soft, 0, dashY - 0.24, dashZ - 0.28);
  // the instrument hood over the gauges (the truck), or a slab screen (the Cybertruck's 18.5")
  if (truck) {
    box(0.46, 0.1, 0.24, soft, ex, dashY + 0.1, dashZ - 0.2, 0.25);
    box(0.36, 0.13, 0.01, glow, ex, dashY + 0.05, dashZ - 0.31, -0.35);
  } else {
    box(0.47, 0.29, 0.03, soft, 0, dashY + 0.2, dashZ - 0.32, -0.18);
    box(0.44, 0.26, 0.01, glow, 0, dashY + 0.2, dashZ - 0.34, -0.18);
  }
  // A-pillars, raked (the truck's cab almost upright; the Cybertruck's long glass)
  const rake = truck ? 0.16 : 0.92, pillarH = truck ? 1.0 : 0.95;
  for (const sd of [1, -1]) {
    const p = box(0.09, pillarH, 0.12, dark, sd * (W / 2 - 0.08), dashY + pillarH / 2 * Math.cos(rake), dashZ + 0.08 - pillarH / 2 * Math.sin(rake) * 0.9, -rake);
    p.rotation.z = sd * 0.04;
    // mirrors, out past the doors
    box(0.05, truck ? 0.34 : 0.13, truck ? 0.2 : 0.22, dark, sd * (W / 2 + 0.2), dashY + (truck ? 0.18 : 0.12), dashZ - 0.05);
    box(0.012, truck ? 0.3 : 0.1, truck ? 0.17 : 0.19, trim, sd * (W / 2 + 0.17), dashY + (truck ? 0.18 : 0.12), dashZ - 0.05);
    // door tops and window sills
    box(0.07, 0.07, 1.4, dark, sd * (W / 2 - 0.04), dashY + 0.02, ez - 0.2);
  }
  // the roof's front edge and a sun visor each side
  const roofY = ey + (truck ? 0.34 : 0.3), roofZ = truck ? dashZ - 0.02 : ez + 0.12;
  box(W - 0.1, 0.07, truck ? 0.3 : 0.5, soft, 0, roofY, roofZ);
  for (const sd of [1, -1]) box(0.62, 0.02, 0.24, soft, sd * 0.42, roofY - 0.06, roofZ - 0.12, 0.25);
  // the rear-view mirror (the truck's box behind has no window: none there)
  if (!truck) box(0.22, 0.07, 0.02, dark, -0.02, roofY - 0.12, roofZ + 0.08);
  // the steering wheel in front of the driver, tilted toward them
  const wheel = new THREE.Group();
  const rimG = truck ? new THREE.TorusGeometry(0.21, 0.022, 10, 40) : new THREE.TorusGeometry(0.18, 0.024, 10, 4, Math.PI * 2);
  const rim = new THREE.Mesh(rimG, soft); if (!truck) { rim.rotation.z = Math.PI / 4; rim.scale.set(1.25, 0.82, 1); }
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20), dark); hub.rotation.x = Math.PI / 2; wheel.add(hub);
  for (const a of [Math.PI / 2, Math.PI * 1.17, -Math.PI * 0.17]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.02), trim);
    sp.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); sp.rotation.z = a; wheel.add(sp);
  }
  const tilt = new THREE.Group();
  tilt.position.set(ex, ey - 0.42, ez + 0.44); tilt.rotation.x = truck ? -0.45 : -0.28;
  tilt.add(wheel); group.add(tilt);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.4, 12), dark);
  col.position.set(ex, ey - 0.52, ez + 0.62); col.rotation.x = Math.PI / 2 - 0.5; group.add(col);
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return {
    group,
    /** the steering wheel's turn, for the front wheels' angle (about 15:1, the truck's slower) */
    setSteer(rad: number) { wheel.rotation.z = rad * (truck ? 18 : 12); },
    dispose() { group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mats.forEach(m => m.dispose()); },
  };
}
