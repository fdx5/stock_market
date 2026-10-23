import { useEffect, useRef, type RefObject } from "react";

/** Tiles at or above this change show small fireworks around the tile and gold dust falling from the name to the map floor. */
export const SURGE_THRESHOLD = 5;

type Target = { x:number; y:number; nameW:number; left:number; right:number; top:number; bottom:number; radius:number; nextBurst:number; burst:number; dust:number; dustUntil:number; carry:number };
type Particle = { x:number; y:number; vx:number; vy:number; life:number; decay:number; size:number; sprite:number; gravity:number; drag:number;
  kind:number; age:number; ox:number; spin:number; floor:number; split:number; trail:boolean; shed:boolean; pop?:() => void };

// Firework cases, rotated per tile so neighbouring bursts never look alike.
const BURSTS = ["peony", "chrysanthemum", "willow", "crossette", "double-ring", "crackle", "spiral", "palm",
  "heart", "star", "saturn", "tilted-ring", "butterfly", "multi-break"] as const;
// Gold dust cases: how the grains travel from the name down to the tile's bottom edge.
const DUSTS = ["shower", "flutter", "spiral", "drizzle", "curtain"] as const;
const PALETTE = ["#fffbe8", "#ffe9a3", "#ffd76a", "#f2b53a", "#ff8a6b", "#ff5d7a", "#fff1c9",
  "#5ff0ff", "#ff5fd2", "#b98cff", "#7dff9a", "#ffa24d", "#ff3d5a", "#6fa8ff", "#fff36b", "#ff9ee6"];
const GOLD = [1, 2, 3, 6];
const VIVID = [7, 8, 9, 10, 11, 12, 13, 14, 15];
// Firework colour schemes: one hue, a pair, a rainbow wheel, or gold with an accent.
function fireworkColors():(index:number, count:number) => number {
  const hue = () => VIVID[Math.floor(Math.random() * VIVID.length)];
  const scheme = Math.floor(Math.random() * 4), a = hue(); let b = hue(); if (b === a) b = VIVID[(VIVID.indexOf(a) + 3) % VIVID.length];
  if (scheme === 0) return () => a;
  if (scheme === 1) return index => index % 2 ? a : b;
  if (scheme === 2) { const offset = Math.floor(Math.random() * VIVID.length); return (index, count) => VIVID[(offset + Math.floor(index / Math.max(1, count) * VIVID.length)) % VIVID.length]; }
  return index => index % 3 ? GOLD[index % GOLD.length] : a;
}
const MAX_PARTICLES = 4200;
const KIND = { spark:0, willow:1, crackle:2, dust:4, streak:5, flutter:6, helix:7, rocket:8 };

function makeSprites(dpr:number) {
  return PALETTE.map(color => {
    const size = Math.ceil(14 * dpr), canvas = document.createElement("canvas"), r = size / 2;
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!, glow = context.createRadialGradient(r, r, 0, r, r, r);
    glow.addColorStop(0, "#ffffff"); glow.addColorStop(.2, color); glow.addColorStop(.5, color + "50"); glow.addColorStop(1, color + "00");
    context.fillStyle = glow; context.fillRect(0, 0, size, size);
    return canvas;
  });
}

const motionAllowed = () => document.documentElement.dataset.fx !== "minimal" && !matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Canvas overlay for a treemap container; tiles opt in with `data-surge`. `layoutKey` changes when tiles move. */
export default function MapSurgeFx({ containerRef, layoutKey }:{ containerRef:RefObject<HTMLDivElement | null>; layoutKey:string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targets = useRef<Target[]>([]);
  const measure = useRef<() => void>(() => {});

  useEffect(() => { measure.current(); }, [layoutKey]);

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    const context = canvas.getContext("2d")!;
    let dpr = 1, sprites:HTMLCanvasElement[] = [], frame = 0, last = 0, visible = false, width = 0, height = 0;
    const particles:Particle[] = [];

    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 3);
      width = container.clientWidth; height = container.clientHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px"; canvas.style.height = height + "px";
      sprites = makeSprites(dpr);
    };
    measure.current = () => {
      const box = container.getBoundingClientRect(), now = performance.now(), previous = new Map(targets.current.map(t => [`${Math.round(t.left)}:${Math.round(t.bottom)}`, t]));
      targets.current = [...container.querySelectorAll<HTMLElement>(".kospi-map-tile[data-surge]")].map((tile, index) => {
        const tileBox = tile.getBoundingClientRect(), name = tile.querySelector<HTMLElement>(".kospi-map-tile-name") ?? tile.querySelector<HTMLElement>(".kospi-map-tile-pct");
        const nameBox = name?.getBoundingClientRect() ?? tileBox;
        const left = tileBox.left - box.left, bottom = tileBox.bottom - box.top;
        const old = previous.get(`${Math.round(left)}:${Math.round(bottom)}`);
        return { x:nameBox.left - box.left + nameBox.width / 2, y:nameBox.top - box.top, nameW:Math.max(10, nameBox.width), left, right:tileBox.right - box.left, top:tileBox.top - box.top, bottom,
          radius:Math.max(12, Math.min(44, tileBox.width * .2, tileBox.height * .35)),
          nextBurst:old?.nextBurst ?? now + Math.random() * 900, burst:old?.burst ?? index % BURSTS.length,
          dust:old?.dust ?? index % DUSTS.length, dustUntil:old?.dustUntil ?? now + 2600 + Math.random() * 2000, carry:0 };
      });
      start();
    };

    const add = (p:Partial<Particle> & { x:number; y:number }) => {
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({ vx:0, vy:0, life:1, decay:1, size:1, sprite:2, gravity:90, drag:2.2, kind:KIND.spark, age:0, ox:p.x, spin:Math.random() * 6.28, floor:height, split:0, trail:false, shed:false, ...p });
    };
    const color = () => GOLD[Math.floor(Math.random() * GOLD.length)];

    const burst = (t:Target) => {
      // Anywhere over the tile's area, a little past its edges. A rocket climbs there first.
      const margin = t.radius * .5, r = t.radius, kind = BURSTS[t.burst];
      const cx = t.left - margin + Math.random() * (t.right - t.left + margin * 2), cy = t.top - margin + Math.random() * (t.bottom - t.top + margin * 2);
      const rise = Math.min(r * 2.6, Math.max(18, t.bottom - cy)), paint = fireworkColors();
      add({ x:cx + (Math.random() - .5) * 6, y:cy + rise, vy:-rise * 3.2, gravity:0, drag:0, decay:3.1, size:.8, sprite:1, kind:KIND.rocket, trail:true,
        pop:() => explode(cx, cy, r, kind, paint) });
      t.burst = (t.burst + 1 + Math.floor(Math.random() * 4)) % BURSTS.length;
      t.nextBurst = performance.now() + 900 + Math.random() * 1400;
    };

    const explode = (cx:number, cy:number, r:number, kind:typeof BURSTS[number], paint:ReturnType<typeof fireworkColors>) => {
      const speed = r * 3.4, second = fireworkColors();
      const shoot = (dx:number, dy:number, v:number, i:number, n:number, extra:Partial<Particle> = {}, colors = paint) =>
        add({ x:cx, y:cy, vx:dx * v, vy:dy * v, sprite:colors(i, n), decay:1.2, size:.85, shed:true, ...extra });
      // Points on a sphere seen from the side: dense rim, filled centre, so bursts look round.
      const sphere = (n:number, scale:number, extra:Partial<Particle> = {}, colors = paint) => {
        for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.28, k = Math.sqrt(1 - u * u); shoot(Math.cos(a) * k, Math.sin(a) * k, speed * scale * (.92 + Math.random() * .16), i, n, extra, colors); }
      };
      const ring = (n:number, scale:number, tilt:number, turn:number, extra:Partial<Particle> = {}, colors = paint) => {
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.28, x = Math.cos(a), y = Math.sin(a) * tilt;
          shoot(x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn), speed * scale, i, n, extra, colors);
        }
      };
      const outline = (points:[number, number][], extra:Partial<Particle> = {}) => points.forEach(([x, y], i) => shoot(x, y, speed, i, points.length, extra));
      if (kind === "peony") sphere(46, 1);
      else if (kind === "chrysanthemum") sphere(34, 1.05, { trail:true, decay:1 });
      else if (kind === "willow") sphere(30, .75, { kind:KIND.willow, decay:.62, gravity:120, drag:2.6, trail:true }, () => 3);
      else if (kind === "crossette") ring(9, 1.05, 1, 0, { decay:1.5, size:1.3, split:1, trail:true });
      else if (kind === "double-ring") { ring(30, 1.1, 1, 0, { decay:1.3 }); sphere(18, .5, { decay:1.15 }, second); }
      else if (kind === "crackle") sphere(38, .85, { kind:KIND.crackle, decay:1.05, size:.75 });
      else if (kind === "spiral") for (let i = 0; i < 36; i++) { const a = i * .55; shoot(Math.cos(a), Math.sin(a), speed * (.2 + i / 36 * .9), i, 36, { trail:i % 3 === 0 }); }
      else if (kind === "palm") for (let arm = 0; arm < 7; arm++) {
        const a = -Math.PI / 2 + (arm - 3) * .5;
        shoot(Math.cos(a), Math.sin(a), speed * 1.05, arm, 7, { size:1.4, gravity:160, decay:.85, trail:true });
      }
      else if (kind === "heart") {
        const points:[number, number][] = [];
        for (let i = 0; i < 40; i++) { const a = i / 40 * 6.28; points.push([16 * Math.sin(a) ** 3 / 17, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17]); }
        outline(points, { gravity:40, decay:1.05 });
      }
      else if (kind === "star") {
        // Five tips (radius 1) joined to inner corners (radius .42) by straight edges.
        const points:[number, number][] = [], turn = Math.random() * 6.28;
        for (let corner = 0; corner < 10; corner++) {
          const a0 = turn + corner / 10 * 6.28, a1 = turn + (corner + 1) / 10 * 6.28, r0 = corner % 2 ? .42 : 1, r1 = corner % 2 ? 1 : .42;
          for (let k = 0; k < 4; k++) { const f = k / 4; points.push([Math.cos(a0) * r0 * (1 - f) + Math.cos(a1) * r1 * f, Math.sin(a0) * r0 * (1 - f) + Math.sin(a1) * r1 * f]); }
        }
        outline(points, { gravity:40, decay:1.05 });
      }
      else if (kind === "saturn") { sphere(22, .45, { decay:1.1 }); ring(34, 1.15, .28, (Math.random() - .5) * .9, { decay:1.2, size:.7 }, second); }
      else if (kind === "tilted-ring") { const turn = Math.random() * 6.28; ring(36, 1, .35, turn); ring(24, .62, .35, turn, {}, second); }
      else if (kind === "butterfly") for (let i = 0; i < 48; i++) {
        const a = i / 48 * 12.56, k = Math.exp(Math.cos(a)) - 2 * Math.cos(4 * a) - Math.sin(a / 12) ** 5;
        shoot(Math.sin(a) * k / 3.6, -Math.cos(a) * k / 3.6, speed, i, 48, { gravity:40 });
      }
      else sphere(14, .7, { decay:1.4, size:1.2, split:2, trail:true }); // multi-break: each star bursts again
      add({ x:cx, y:cy, sprite:0, size:r / 3.2, decay:6, gravity:0, drag:0 }); // white flash at the core
      add({ x:cx, y:cy, sprite:paint(0, 1), size:r / 1.6, decay:4, gravity:0, drag:0 }); // coloured halo
    };

    const pour = (t:Target, dt:number, now:number) => {
      if (now > t.dustUntil) { t.dust = (t.dust + 1 + Math.floor(Math.random() * (DUSTS.length - 1))) % DUSTS.length; t.dustUntil = now + 2600 + Math.random() * 2000; }
      t.carry += dt * Math.min(46, 12 + t.nameW * .35);
      const kind = DUSTS[t.dust], fall = Math.max(60, height - t.y);
      for (; t.carry >= 1; t.carry--) {
        const x = t.x + (Math.random() - .5) * t.nameW * (kind === "curtain" ? 1.1 : .7), y = t.y + 6 + Math.random() * 6;
        // Grains fall all the way to the map floor; lifetimes are long enough to arrive.
        const base = { x, y, sprite:color(), floor:height, drag:.4, size:.3 + Math.random() ** 2 * .7 }, reach = Math.sqrt(fall / 400);
        if (kind === "shower") add({ ...base, kind:KIND.dust, vy:20 + Math.random() * 30, gravity:420, decay:.6 / reach });
        else if (kind === "flutter") add({ ...base, kind:KIND.flutter, vy:30, gravity:160, decay:.42 / reach, size:base.size * 1.3 });
        else if (kind === "spiral") add({ ...base, kind:KIND.helix, vy:30, gravity:240, decay:.5 / reach });
        else if (kind === "drizzle") add({ ...base, kind:KIND.streak, vy:110 + Math.random() * 60, gravity:900, decay:.85 / reach });
        else add({ ...base, kind:KIND.dust, vy:10 + Math.random() * 15, gravity:300, decay:.55 / reach, size:base.size * .8 });
      }
    };

    const tick = (now:number) => {
      frame = 0;
      if (!visible || document.hidden || !motionAllowed()) { context.clearRect(0, 0, canvas.width, canvas.height); particles.length = 0; last = 0; return; }
      const dt = Math.min(.05, last ? (now - last) / 1000 : 1 / 60); last = now;
      const share = Math.min(1, 14 / Math.max(1, targets.current.length));
      for (const t of targets.current) {
        if (now >= t.nextBurst) { if (Math.random() < share) burst(t); else t.nextBurst = now + 600 + Math.random() * 900; }
        pour(t, dt * share, now);
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "destination-out";
      context.globalAlpha = 1; context.fillStyle = "rgba(0,0,0,.32)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "lighter";
      let alive = 0;
      for (const p of particles) {
        p.age += dt;
        p.vx *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.gravity * dt;
        if (p.kind === KIND.flutter) p.x += (p.vx + Math.sin(p.age * 3.4 + p.spin) * 28) * dt;
        else if (p.kind === KIND.helix) p.x = p.ox + Math.sin(p.age * 6 + p.spin) * (3 + p.age * 7);
        else p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.kind === KIND.rocket && (p.life < .05 || p.vy > -20)) { p.life = 0; p.pop?.(); }
        if (p.split && p.life < .45) {
          // Crossette: each star splits into a cross; multi-break: each star pops into a small sphere.
          const count = p.split === 1 ? 4 : 10, push = p.split === 1 ? 45 : 32;
          for (let i = 0; i < count; i++) { const a = i / count * 6.28 + Math.PI / 4; add({ x:p.x, y:p.y, vx:Math.cos(a) * push, vy:Math.sin(a) * push, sprite:i % 2 ? p.sprite : 0, decay:2.1, size:.6, floor:p.floor }); }
          add({ x:p.x, y:p.y, sprite:0, size:2.2, decay:7, gravity:0, drag:0 });
          p.split = 0;
        }
        if (p.trail && p.life > .15 && Math.random() < .7)
          add({ x:p.x + (Math.random() - .5) * 2, y:p.y + (Math.random() - .5) * 2, vx:p.vx * .05, vy:p.vy * .05, sprite:p.kind === KIND.rocket ? 2 : p.sprite, decay:2.6, gravity:30, drag:3, size:.42, floor:p.floor });
        // Firework stars drop dust in their own colour, which falls to the map floor.
        if (p.shed && (p.life <= 0 || Math.random() < .05)) {
          const reach = Math.sqrt(Math.max(60, height - p.y) / 400);
          for (let i = p.life <= 0 ? 2 : 1; i > 0; i--)
            add({ x:p.x + (Math.random() - .5) * 3, y:p.y, vx:p.vx * .15 + (Math.random() - .5) * 10, vy:10 + Math.random() * 20, sprite:p.sprite,
              kind:Math.random() < .35 ? KIND.flutter : KIND.dust, gravity:260 + Math.random() * 120, drag:.4, decay:.55 / reach, size:.3 + Math.random() * .4 });
        }
        if (p.life <= 0 || p.y > p.floor - 1) continue;
        particles[alive++] = p;
        let alpha = Math.min(1, p.life * 1.8);
        if (p.kind === KIND.crackle) alpha *= Math.sin(p.age * 60 + p.spin) > .2 ? 1 : .15;
        if (p.floor - p.y < 14) alpha *= (p.floor - p.y) / 14; // fade at the map floor
        const twinkle = .7 + .3 * Math.sin(now / 80 + p.spin * 9), size = p.size * dpr * 5 * twinkle;
        context.globalAlpha = alpha;
        const px = p.x * dpr, py = p.y * dpr, image = sprites[p.sprite];
        if (p.kind === KIND.streak) { const stretch = 1 + Math.min(2.5, p.vy / 120); context.drawImage(image, px - size / 4, py - size * stretch / 2, size / 2, size * stretch); }
        else context.drawImage(image, px - size / 2, py - size / 2, size, size);
      }
      particles.length = alive;
      context.globalAlpha = 1;
      if (targets.current.length || particles.length) frame = requestAnimationFrame(tick);
      else { context.clearRect(0, 0, canvas.width, canvas.height); last = 0; }
    };
    const start = () => { if (!frame && visible && !document.hidden && motionAllowed() && (targets.current.length || particles.length)) frame = requestAnimationFrame(tick); };

    resize();
    const sizes = new ResizeObserver(() => { resize(); measure.current(); }); sizes.observe(container);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); }); seen.observe(container);
    const wake = () => start();
    document.addEventListener("visibilitychange", wake);
    measure.current();
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); seen.disconnect(); document.removeEventListener("visibilitychange", wake); measure.current = () => {}; };
  }, [containerRef]);

  return <canvas ref={canvasRef} className="kospi-map-surge-fx" aria-hidden="true"/>;
}
