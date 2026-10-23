/** Gold dust that pours from the mouse pointer and falls to the bottom of the screen.
 *  One full-viewport canvas, created on first use; the loop runs only while grains are alive.
 *  Ten fall patterns rotate while hovering, with a mix of other patterns, light trails,
 *  star glints and sparks where grains land. */
type Grain = { x:number; y:number; vx:number; vy:number; size:number; life:number; spin:number; sprite:number;
  pattern:number; age:number; ox:number; oy:number; star:boolean; spark:boolean };

export const DUST_PATTERNS = ["shower", "flutter", "spiral", "wind", "fountain", "drizzle", "vortex", "curtain", "firework", "comet"] as const;
const MAX_GRAINS = 1400;
const COLORS = ["#fff4c2", "#ffd76a", "#f2b53a", "#ffe9a3", "#d9962b", "#fffbe8"];
// Per pattern: gravity, terminal speed, lifetime decay per second
const PHYSICS = [
  { gravity:620, terminal:340, decay:.2 },  // shower: heavy grains, straight down
  { gravity:150, terminal:85, decay:.13 },  // flutter: light flakes swinging like a pendulum
  { gravity:260, terminal:150, decay:.16 }, // spiral: widening helix around the fall line
  { gravity:380, terminal:210, decay:.18 }, // wind: a gust carries grains diagonally
  { gravity:560, terminal:300, decay:.17 }, // fountain: thrown up, then falling
  { gravity:900, terminal:520, decay:.22 }, // drizzle: fast streaks like rain
  { gravity:200, terminal:170, decay:.15 }, // vortex: orbit the pointer, then spill down
  { gravity:420, terminal:260, decay:.18 }, // curtain: a wide sheet released along a line
  { gravity:300, terminal:230, decay:.2 },  // firework: a ring bursts, glints drift down
  { gravity:480, terminal:300, decay:.19 }, // comet: bright heads with long tails
];

function sprites(dpr:number) {
  return COLORS.map(color => {
    const size = Math.ceil(16 * dpr), canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!, r = size / 2;
    const glow = context.createRadialGradient(r, r, 0, r, r, r);
    glow.addColorStop(0, "#ffffff"); glow.addColorStop(.18, color); glow.addColorStop(.45, color + "55"); glow.addColorStop(1, color + "00");
    context.fillStyle = glow; context.fillRect(0, 0, size, size);
    return canvas;
  });
}

function starSprite(dpr:number) {
  const size = Math.ceil(40 * dpr), canvas = document.createElement("canvas"), r = size / 2;
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  for (const [w, h] of [[size, 1.6 * dpr], [1.6 * dpr, size]]) {
    const ray = context.createRadialGradient(r, r, 0, r, r, r);
    ray.addColorStop(0, "#ffffff"); ray.addColorStop(.25, "#ffe7a0cc"); ray.addColorStop(1, "#ffd76a00");
    context.fillStyle = ray; context.fillRect(r - w / 2, r - h / 2, w, h);
  }
  return canvas;
}

export function createGoldDust() {
  let canvas:HTMLCanvasElement|null = null, context:CanvasRenderingContext2D|null = null;
  let images:HTMLCanvasElement[] = [], star:HTMLCanvasElement|null = null, dpr = 1, frame = 0, last = 0;
  let primary = 0, windSign = 1, shuffledAt = 0, emitted = 0;
  const grains:Grain[] = [];

  const resize = () => {
    if (!canvas) return;
    dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    images = sprites(dpr); star = starSprite(dpr);
  };
  const mount = () => {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "sc-gold-dust";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    context = canvas.getContext("2d");
    resize(); addEventListener("resize", resize);
  };
  const grain = (x:number, y:number, pattern:number, vx = 0, vy = 0):Grain => {
    const r = Math.random();
    return { x, y, vx, vy, size:.35 + r * r * 1.1, life:.75 + Math.random() * .5, spin:Math.random() * 6.28,
      sprite:Math.floor(Math.random() * images.length), pattern, age:0, ox:x, oy:y, star:Math.random() < .07, spark:false };
  };
  const spawn = (x:number, y:number, pattern:number, index:number, count:number):Grain => {
    const angle = Math.random() * Math.PI * 2, g = grain(x, y, pattern);
    switch (pattern) {
      case 0: g.vx = (Math.random() - .5) * 40; g.vy = Math.random() * 60; break;
      case 1: g.vx = (Math.random() - .5) * 30; g.vy = -10 + Math.random() * 20; g.size *= 1.25; break;
      case 2: g.vy = 20 + Math.random() * 30; break;
      case 3: g.vx = windSign * (90 + Math.random() * 120); g.vy = Math.random() * 40; break;
      case 4: { const burst = 140 + Math.random() * 180; g.vx = Math.cos(angle) * burst * .55; g.vy = -Math.abs(Math.sin(angle)) * burst - 60; break; }
      case 5: g.vx = (Math.random() - .5) * 12; g.vy = 140 + Math.random() * 120; g.size *= .8; break;
      case 6: g.spin = angle; g.vy = 0; break;
      case 7: g.x = g.ox = x + (index / Math.max(1, count - 1) - .5) * 160 + (Math.random() - .5) * 8; g.vy = Math.random() * 30; break;
      case 8: { const ring = (index / count) * Math.PI * 2 + emitted * .7, burst = 170 + Math.random() * 60;
        g.vx = Math.cos(ring) * burst; g.vy = Math.sin(ring) * burst - 40; g.star = Math.random() < .2; break; }
      default: g.vx = windSign * (40 + Math.random() * 60); g.vy = 30 + Math.random() * 50; g.size *= 1.5; g.star = true;
    }
    return g;
  };
  const tick = (now:number) => {
    if (!canvas || !context) return;
    const dt = Math.min(.05, last ? (now - last) / 1000 : 1 / 60); last = now;
    const height = innerHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    // Fade the previous frame instead of clearing it: every grain leaves a light trail.
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = 1;
    context.fillStyle = "rgba(0,0,0,.34)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "lighter";
    let alive = 0;
    const sparks:Grain[] = [];
    for (const g of grains) {
      const physics = PHYSICS[g.pattern];
      g.age += dt;
      if (g.pattern === 6 && g.age < .9) {
        // Orbit the release point on a tightening ring before spilling down.
        const radius = 34 * (1 - g.age / .9) + 6;
        g.spin += dt * (9 - g.age * 4);
        g.x = g.ox + Math.cos(g.spin) * radius; g.y = g.oy + Math.sin(g.spin) * radius * .55 + g.age * 18;
      } else {
        g.vy = Math.min(g.vy + physics.gravity * dt, physics.terminal * (.8 + g.size * .2));
        if (g.pattern === 1) {
          g.x += (g.vx + Math.sin(g.age * 3.2 + g.spin) * 75) * dt;
          g.vx *= 1 - 2 * dt;
        } else if (g.pattern === 2) {
          g.x = g.ox + Math.sin(g.age * 5 + g.spin) * (8 + g.age * 16);
        } else if (g.pattern === 3 || g.pattern === 9) {
          g.x += (g.vx + Math.sin(now / 260 + g.spin) * 20) * dt;
          g.vx *= 1 - .25 * dt;
        } else {
          g.vx *= 1 - (g.pattern === 4 || g.pattern === 8 ? .9 : 1.6) * dt;
          g.x += (g.vx + (g.pattern === 5 ? 0 : Math.sin(now / 340 + g.spin) * 10)) * dt;
        }
        g.y += g.vy * dt;
      }
      g.life -= dt * (g.spark ? .9 : physics.decay);
      if (g.y > height - 2 && !g.spark && g.vy > 0) {
        // Landing: a couple of tiny sparks bounce off the bottom edge.
        if (sparks.length < 40 && Math.random() < .35)
          for (let i = 0; i < 2; i++) {
            const s = grain(g.x, height - 3, 0, (Math.random() - .5) * 120, -(80 + Math.random() * 120));
            s.spark = true; s.size = .3 + Math.random() * .3; s.life = .5; sparks.push(s);
          }
        continue;
      }
      if (g.life <= 0 || g.y > height + 20) continue;
      grains[alive++] = g;
      const twinkle = .55 + .45 * Math.sin(now / 90 + g.spin * 7);
      const size = g.size * (1 + twinkle * .5) * dpr * 4;
      context.globalAlpha = Math.min(1, g.life * 1.6) * (.45 + twinkle * .55);
      const px = g.x * dpr, py = g.y * dpr, image = images[g.sprite];
      if (g.pattern === 5) {
        const stretch = 1 + Math.min(3, g.vy / 140);
        context.drawImage(image, px - size / 4, py - size * stretch / 2, size / 2, size * stretch);
      } else {
        context.drawImage(image, px - size / 2, py - size / 2, size, size);
      }
      if (g.star && star && twinkle > .82) {
        const glint = size * (g.pattern === 9 ? 3.2 : 2.4);
        context.globalAlpha *= (twinkle - .82) / .18;
        context.drawImage(star, px - glint / 2, py - glint / 2, glint, glint);
      }
    }
    grains.length = alive;
    for (const s of sparks) if (grains.length < MAX_GRAINS) grains.push(s);
    context.globalAlpha = 1;
    frame = grains.length ? requestAnimationFrame(tick) : 0;
    if (!frame) { last = 0; context.clearRect(0, 0, canvas.width, canvas.height); }
  };

  /** Choose a new fall pattern, different from the previous one. */
  const shuffle = () => {
    primary = (primary + 1 + Math.floor(Math.random() * (DUST_PATTERNS.length - 1))) % DUST_PATTERNS.length;
    windSign = Math.random() < .5 ? -1 : 1; shuffledAt = performance.now();
    return DUST_PATTERNS[primary];
  };

  return {
    shuffle,
    /** Pour grains at a viewport point; `speed` is the pointer's travel in px since the last call. */
    pour(x:number, y:number, speed:number) {
      mount();
      if (performance.now() - shuffledAt > 1400) shuffle();
      emitted++;
      const burst = primary === 8 ? (emitted % 6 === 0 ? 28 : 3) : primary === 7 ? 18 : 0;
      const count = burst || Math.min(16, 5 + Math.round(speed / 5));
      for (let i = 0; i < count && grains.length < MAX_GRAINS; i++) {
        const mixed = !burst && Math.random() > .82, pattern = mixed ? Math.floor(Math.random() * DUST_PATTERNS.length) : primary;
        const g = spawn(x + (Math.random() - .5) * 6, y + (Math.random() - .5) * 6, pattern, i, count);
        // A comet head drags a short tail of fainter grains behind it.
        if (pattern === 9 && grains.length + 4 < MAX_GRAINS)
          for (let t = 1; t <= 4; t++) {
            const tail = grain(g.x - g.vx * t * .02, g.y - g.vy * t * .02, 9, g.vx, g.vy);
            tail.size = g.size * (1 - t * .18); tail.life = g.life * (1 - t * .12); tail.star = false; grains.push(tail);
          }
        grains.push(g);
      }
      if (!frame) frame = requestAnimationFrame(tick);
    },
    dispose() {
      cancelAnimationFrame(frame); frame = 0; grains.length = 0;
      removeEventListener("resize", resize);
      canvas?.remove(); canvas = null; context = null;
    },
  };
}
