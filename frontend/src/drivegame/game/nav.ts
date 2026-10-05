import * as THREE from "three";

/** The delivery game on top of driving (driveSim): a destination — one of the complexes round
 * the view, at random — the way there along the roads as a green line on the road with arrows
 * running along it, a light column over the destination, turn-by-turn directions, a minimap;
 * gold on arrival in proportion to the distance, with bonuses for time and for no knocks. */

export type Pt = [number, number];

/** Where along a polyline a point is (metres from its start) and how far off it. */
export function progressOn(line: Pt[], x: number, y: number) {
  let best = { along: 0, off: Infinity, seg: 1 }, acc = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (l * l))), off = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (off < best.off) best = { along: acc + l * t, off, seg: i };
    acc += l;
  }
  return { ...best, total: acc };
}

export function lengthOf(line: Pt[]) { let s = 0; for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return s; }

/** The polyline from `from` metres on. */
export function cutFrom(line: Pt[], from: number): Pt[] {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (acc + l >= from) {
      const t = (from - acc) / (l || 1);
      return [[line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t], ...line.slice(i)];
    }
    acc += l;
  }
  return [line[line.length - 1]];
}

export type TurnKind = "left" | "right" | "uturn" | "straight" | "arrive";
/** The next turn ahead on the remaining way: the first bend of more than 35° (over ~8 m either
 * side of it, so a curve of short segments reads as one turn), and how far ahead. */
export function nextTurn(rest: Pt[]): { kind: TurnKind; dist: number } {
  const total = lengthOf(rest);
  const cum = [0];
  for (let i = 1; i < rest.length; i++) cum.push(cum[i - 1] + Math.hypot(rest[i][0] - rest[i - 1][0], rest[i][1] - rest[i - 1][1]));
  const at = (d: number): Pt => {
    d = Math.max(0, Math.min(total, d));
    let i = 1; while (i < rest.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [rest[i - 1][0] + (rest[i][0] - rest[i - 1][0]) * t, rest[i - 1][1] + (rest[i][1] - rest[i - 1][1]) * t];
  };
  for (let i = 1; i < rest.length - 1; i++) {
    const d = cum[i];
    if (d < 4) continue;
    const a = at(d - 8), b = at(d), c = at(d + 8);
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1 || lv < 1) continue;
    const ang = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (Math.abs(ang) > 0.61) return { kind: Math.abs(ang) > 2.5 ? "uturn" : ang > 0 ? "left" : "right", dist: d };
  }
  return { kind: total < 30 ? "arrive" : "straight", dist: total };
}

/** The way as a ribbon on the road: green, glowing, with chevrons running along it. */
export function routeRibbon(roadAt: (x: number, y: number) => number) {
  const tex = chevronTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: "#ffffff", transparent: true, opacity: 0.92, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.name = "route";
  let flow = 0;
  return {
    mesh,
    set(line: Pt[]) {
      const W = 1.5, LIFT = 0.16, STEP = 2;
      const pts: Pt[] = [];
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i], l = Math.hypot(bx - ax, by - ay);
        for (let d = 0; d < l; d += STEP) pts.push([ax + (bx - ax) * d / l, ay + (by - ay) * d / l]);
      }
      if (line.length) pts.push(line[line.length - 1]);
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let v = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l, [x, y] = pts[i];
        if (i) v += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
        for (const s of [-1, 1]) { const px = x + nx * s * W / 2, py = y + ny * s * W / 2; pos.push(px, roadAt(px, py) + LIFT, -py); uv.push(s < 0 ? 0 : 1, v / 3); }
        if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.visible = pts.length > 1;
    },
    /** the arrows run toward the destination */
    update(dt: number) { flow = (flow - dt * 1.6) % 1; tex.offset.y = flow; },
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); mesh.removeFromParent(); },
  };
}

function chevronTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgba(40,255,140,0)"); grad.addColorStop(0.18, "rgba(40,255,140,.55)"); grad.addColorStop(0.5, "rgba(80,255,170,.75)");
  grad.addColorStop(0.82, "rgba(40,255,140,.55)"); grad.addColorStop(1, "rgba(40,255,140,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  // a chevron pointing along +v (the way on)
  g.strokeStyle = "rgba(235,255,245,.95)"; g.lineWidth = 18; g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath(); g.moveTo(26, 90); g.lineTo(64, 160); g.lineTo(102, 90); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A column of light over the destination, a pulsing ring at its foot. */
export function beacon() {
  const group = new THREE.Group();
  const colG = new THREE.CylinderGeometry(2.6, 3.4, 160, 32, 1, true).translate(0, 80, 0);
  const tex = (() => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const g = c.getContext("2d")!, gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, "rgba(255,214,90,.85)"); gr.addColorStop(0.25, "rgba(255,200,70,.4)"); gr.addColorStop(1, "rgba(255,190,60,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const colM = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const col = new THREE.Mesh(colG, colM);
  const ringG = new THREE.RingGeometry(4.4, 4.9, 64).rotateX(-Math.PI / 2);
  const ringM = new THREE.MeshBasicMaterial({ color: "#ffd65a", transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const ring = new THREE.Mesh(ringG, ringM);
  ring.position.y = 0.25;
  group.add(col, ring);
  group.renderOrder = 4;
  let t = 0;
  return {
    group,
    place(x: number, y: number, z: number) { group.position.set(x, z, -y); group.visible = true; },
    /** near: the vehicle's distance (m) — close by, the column fades so it never fills the view */
    update(dt: number, near = Infinity) {
      t += dt;
      const k = (t * 0.8) % 1, fade = Math.min(1, Math.max(0.12, (near - 12) / 70));
      ring.scale.setScalar(0.7 + k * 1.1); ringM.opacity = 0.55 * (1 - k) * Math.max(0.4, fade);
      colM.opacity = (0.55 + 0.2 * Math.sin(t * 3)) * fade;
    },
    dispose() { colG.dispose(); colM.dispose(); tex.dispose(); ringG.dispose(); ringM.dispose(); group.removeFromParent(); },
  };
}

/** The minimap: heading up, the roads round the vehicle, the way in green, the destination. */
export function drawMinimap(cv: HTMLCanvasElement, roads: { line: Pt[]; width: number }[], way: Pt[] | null, car: { x: number; y: number; hx: number; hy: number },
  dest: Pt | null, scale = 0.55) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), S = cv.clientWidth || 180;
  if (cv.width !== Math.round(S * dpr)) { cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr); }
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
  g.fillStyle = "rgba(12,16,22,.86)"; g.fillRect(0, 0, S, S);
  // world → map: about the car, heading up (the car a little below the middle)
  const ang = Math.atan2(car.hy, car.hx) - Math.PI / 2, cs = Math.cos(-ang), sn = Math.sin(-ang), cx = S / 2, cy = S * 0.6;
  const tr = (x: number, y: number): Pt => { const dx = (x - car.x) * scale, dy = (y - car.y) * scale; return [cx + dx * cs - dy * sn, cy - (dx * sn + dy * cs)]; };
  const R = (S / scale) * 0.9;
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = "rgba(170,182,198,.55)";
  for (const r of roads) {
    if (!r.line.some(([x, y]) => Math.abs(x - car.x) < R && Math.abs(y - car.y) < R)) continue;
    g.lineWidth = Math.max(1.5, r.width * scale * 0.8);
    g.beginPath();
    r.line.forEach(([x, y], i) => { const [px, py] = tr(x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.stroke();
  }
  if (way && way.length > 1) {
    g.strokeStyle = "rgba(40,255,140,.95)"; g.lineWidth = 4; g.shadowColor = "rgba(40,255,140,.8)"; g.shadowBlur = 6;
    g.beginPath();
    way.forEach(([x, y], i) => { const [px, py] = tr(x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.stroke(); g.shadowBlur = 0;
  }
  if (dest) {
    let [px, py] = tr(dest[0], dest[1]);
    // (off the map: pinned to its rim, pointing the way)
    const dx = px - S / 2, dy = py - S / 2, d = Math.hypot(dx, dy), rim = S / 2 - 12;
    if (d > rim) { px = S / 2 + dx / d * rim; py = S / 2 + dy / d * rim; }
    g.fillStyle = "#ffd65a"; g.strokeStyle = "#3a2a00"; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#3a2a00"; g.font = "bold 9px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("G", px, py + 0.5);
  }
  // the vehicle
  g.fillStyle = "#ffffff"; g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx + 7, cy + 7); g.lineTo(cx, cy + 3); g.lineTo(cx - 7, cy + 7); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1.5; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke();
}

/** Little sounds made on the spot (no files): the arrival chime, coins, the horn, a turn's ping. */
export const sfx = {
  chime(ctx: AudioContext, out: AudioNode = ctx.destination) {
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.11); g.gain.linearRampToValueAtTime(0.28, t + i * 0.11 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.11 + 0.9);
      o.connect(g); g.connect(out); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 1);
    });
  },
  coins(ctx: AudioContext, n: number, out: AudioNode = ctx.destination) {
    const t = ctx.currentTime;
    for (let i = 0; i < Math.min(14, n); i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + 0.5 + i * 0.07;
      o.type = "square"; o.frequency.setValueAtTime(1568, at); o.frequency.setValueAtTime(2093, at + 0.04);
      g.gain.setValueAtTime(0.07, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.18);
    }
  },
  horn(ctx: AudioContext, truck: boolean, out: AudioNode = ctx.destination) {
    const t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 2200;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.02); g.gain.setValueAtTime(0.22, t + 0.42); g.gain.linearRampToValueAtTime(0, t + 0.5);
    for (const fr of truck ? [311, 392] : [415, 523]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 0.52); }
    f.connect(g); g.connect(out);
  },
  ping(ctx: AudioContext, out: AudioNode = ctx.destination) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.09);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.32);
  },
};

/** Gold for a delivery: 1 per 10 m of the way, a time bonus against a par of 8 m/s (about
 * 29 km/h through town), +30% with no knocks, less 5 a knock. */
export function goldFor(wayM: number, secs: number, knocks: number) {
  const base = Math.round(wayM / 10), par = wayM / 8;
  const time = Math.max(0, Math.round((par - secs) * 0.6));
  const clean = knocks === 0 ? Math.round(base * 0.3) : 0;
  const penalty = knocks * 5;
  return { base, time, clean, penalty, total: Math.max(1, base + time + clean - penalty) };
}
