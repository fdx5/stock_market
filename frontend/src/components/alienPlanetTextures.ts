import * as THREE from "three";

export type AlienPlanetKind = "gas" | "ocean" | "rock" | "ice" | "volcanic";
export type AlienPlanetStyle = "standard" | "storm" | "complex-bands";
export interface AlienPlanetMaps {
  surface: THREE.CanvasTexture;
  clouds: THREE.CanvasTexture | null;
  atmosphere: THREE.Color;
  kind: AlienPlanetKind;
  cloudSpeed: number;
}

const PLANET_DESIGN_CACHE_LIMIT = 72;
const planetDesignCache = new Map<string, AlienPlanetMaps>();

function cachedDesign(key: string) {
  const value = planetDesignCache.get(key);
  if (!value) return null;
  planetDesignCache.delete(key);
  planetDesignCache.set(key, value);
  return value;
}

function storeDesign(key: string, value: AlienPlanetMaps) {
  planetDesignCache.set(key, value);
  while (planetDesignCache.size > PLANET_DESIGN_CACHE_LIMIT) {
    const oldestKey = planetDesignCache.keys().next().value as string;
    const oldest = planetDesignCache.get(oldestKey);
    oldest?.surface.dispose();
    oldest?.clouds?.dispose();
    planetDesignCache.delete(oldestKey);
  }
  return value;
}

function seedOf(value: string) {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function asTexture(canvas: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = Math.min(12, aniso);
  return t;
}
function blendHorizontalSeam(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!,
    image = ctx.getImageData(0, 0, canvas.width, canvas.height),
    data = image.data,
    blend = Math.max(24, Math.floor(canvas.width * 0.12)),
    width = canvas.width;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < blend; x++) {
      const opposite = width - 1 - x,
        a = (y * width + x) * 4,
        b = (y * width + opposite) * 4,
        strength = 1 - x / blend;
      for (let channel = 0; channel < 4; channel++) {
        const average = (data[a + channel] + data[b + channel]) * 0.5;
        data[a + channel] = Math.round(
          data[a + channel] * (1 - strength) + average * strength,
        );
        data[b + channel] = Math.round(
          data[b + channel] * (1 - strength) + average * strength,
        );
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
function softenPolarCaps(canvas: HTMLCanvasElement, transparent = false) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!,
    image = ctx.getImageData(0, 0, canvas.width, canvas.height),
    data = image.data,
    width = canvas.width,
    height = canvas.height,
    cap = Math.max(16, Math.floor(height * 0.14));
  for (const top of [true, false]) {
    const referenceY = top ? cap : height - 1 - cap,
      average = [0, 0, 0, 0];
    for (let x = 0; x < width; x++) {
      const p = (referenceY * width + x) * 4;
      for (let c = 0; c < 4; c++) average[c] += data[p + c] / width;
    }
    for (let row = 0; row < cap; row++) {
      const y = top ? row : height - 1 - row,
        strength = Math.pow(1 - row / cap, 1.7);
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          const target = transparent && c === 3 ? 0 : average[c];
          data[p + c] = Math.round(
            data[p + c] * (1 - strength) + target * strength,
          );
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
function flow(
  ctx: CanvasRenderingContext2D,
  size: number,
  rnd: () => number,
  color: string,
  count: number,
  width: number,
  alpha: number,
) {
  ctx.save();
  ctx.filter = `blur(${Math.max(2, width * 0.32)}px)`;
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < count; i++) {
    let x = rnd() * size,
      y = rnd() * size,
      angle = (rnd() - 0.5) * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 18; j++) {
      angle += Math.sin(y / 43 + x / 71) * 0.18 + (rnd() - 0.5) * 0.13;
      x += Math.cos(angle) * (5 + rnd() * 13);
      y += Math.sin(angle) * (3 + rnd() * 9);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * (0.35 + rnd() * 0.65);
    ctx.lineWidth = width * (0.35 + rnd());
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

function atmosphericBands(
  ctx: CanvasRenderingContext2D,
  size: number,
  rnd: () => number,
  colors: string[],
  complex = false,
) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  let y = -size * 0.04,
    index = 0;
  while (y < size * 1.04) {
    const height = (complex ? 3 : 7) + rnd() * (complex ? 13 : 25),
      wave = 2 + rnd() * (complex ? 10 : 5),
      frequency = 1 + rnd() * 4;
    ctx.beginPath();
    ctx.moveTo(-8, y);
    for (let x = -8; x <= size + 8; x += 6) {
      const drift =
        Math.sin((x / size) * Math.PI * 2 * frequency + rnd() * 0.15) * wave +
        Math.sin((x / size) * Math.PI * 2 * (frequency * 0.37) + index) *
          wave *
          0.45;
      ctx.lineTo(x, y + drift);
    }
    ctx.lineTo(size + 8, y + height + wave);
    for (let x = size + 8; x >= -8; x -= 6) {
      const drift =
        Math.sin((x / size) * Math.PI * 2 * frequency + rnd() * 0.15) * wave +
        Math.sin((x / size) * Math.PI * 2 * (frequency * 0.37) + index) *
          wave *
          0.45;
      ctx.lineTo(x, y + height + drift);
    }
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.globalAlpha = (complex ? 0.16 : 0.11) + rnd() * (complex ? 0.25 : 0.13);
    ctx.fill();
    if (complex && rnd() > 0.28) {
      ctx.strokeStyle = colors[(index + 1) % colors.length];
      ctx.globalAlpha = 0.12 + rnd() * 0.2;
      ctx.lineWidth = 0.7 + rnd() * 2.6;
      ctx.stroke();
    }
    y += height * (complex ? 0.72 : 0.92);
    index++;
  }
  ctx.restore();
}

function iceFissures(
  ctx: CanvasRenderingContext2D,
  size: number,
  rnd: () => number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(230,249,255,.42)";
  for (let i = 0; i < 34; i++) {
    let x = rnd() * size,
      y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let p = 0; p < 8; p++) {
      x += (rnd() - 0.48) * size * 0.038;
      y += (rnd() - 0.5) * size * 0.016;
      ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.12 + rnd() * 0.3;
    ctx.lineWidth = 0.45 + rnd() * 1.5;
    ctx.stroke();
  }
  ctx.restore();
}
function lavaVeins(
  ctx: CanvasRenderingContext2D,
  size: number,
  rnd: () => number,
  hot: THREE.Color,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = `#${hot.getHexString()}`;
  ctx.shadowBlur = size * 0.018;
  ctx.strokeStyle = `#${hot.getHexString()}`;
  for (let i = 0; i < 25; i++) {
    let x = rnd() * size,
      y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let p = 0; p < 12; p++) {
      x += (rnd() - 0.45) * size * 0.035;
      y += (rnd() - 0.5) * size * 0.018;
      ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.16 + rnd() * 0.3;
    ctx.lineWidth = 0.5 + rnd() * 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

/** Stable, reusable alien-world generator. No solar-system texture is sampled. */
export function createAlienPlanetMaps(
  key: string,
  brandHex: number,
  aniso = 8,
  size = 512,
  style: AlienPlanetStyle = "standard",
): AlienPlanetMaps {
  size = Math.min(size, 256);
  const designKey = `clouds-v2:${key}:${brandHex.toString(16)}:${size}:${style}`;
  const existing = cachedDesign(designKey);
  if (existing) return existing;
  const quality = size <= 128 ? 0.34 : 1,
    count = (value: number) => Math.max(8, Math.round(value * quality));
  let seed = seedOf(key),
    rnd = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const kinds: AlienPlanetKind[] = ["gas", "ocean", "rock", "ice", "volcanic"],
    kind = kinds[seed % 5];
  const brand = new THREE.Color(brandHex),
    white = brand.clone().lerp(new THREE.Color(0xffffff), 0.72),
    accent = brand.clone().offsetHSL(0, -0.04, 0.14),
    deep = brand.clone().offsetHSL(0, 0.04, -0.28);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!,
    g = c.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `#${deep.getHexString()}`);
  g.addColorStop(0.48, `#${brand.getHexString()}`);
  g.addColorStop(1, `#${accent.getHexString()}`);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const density = kind === "gas" ? 120 : kind === "ocean" ? 85 : 65;
  flow(
    c,
    size,
    rnd,
    `#${white.getHexString()}`,
    count(density),
    kind === "gas" ? 18 : 28,
    0.16,
  );
  flow(
    c,
    size,
    rnd,
    `#${accent.getHexString()}`,
    count(density * 0.72),
    42,
    0.13,
  );
  c.globalCompositeOperation = "multiply";
  flow(
    c,
    size,
    rnd,
    `#${deep.getHexString()}`,
    count(density * 0.55),
    24,
    0.18,
  );
  if (style !== "standard")
    atmosphericBands(
      c,
      size,
      rnd,
      [
        `#${white.getHexString()}`,
        `#${accent.getHexString()}`,
        `#${deep.getHexString()}`,
      ],
      style === "complex-bands",
    );
  /* Broad vortices used to read as pasted-on ellipses once wrapped around a
     small sphere. Storm worlds now use several irregular flowing cloud bands
     instead, with every parameter seeded by the stock code. */
  if (style === "storm") {
    atmosphericBands(
      c,
      size,
      rnd,
      [
        `#${white.getHexString()}`,
        `#${accent.getHexString()}`,
        `#${deep.getHexString()}`,
      ],
      true,
    );
    flow(c, size, rnd, `#${white.getHexString()}`, count(145), 13, 0.2);
    c.globalCompositeOperation = "multiply";
    flow(c, size, rnd, `#${deep.getHexString()}`, count(92), 19, 0.16);
  }
  if (kind === "gas" && style === "standard")
    atmosphericBands(c, size, rnd, [
      `#${white.getHexString()}`,
      `#${accent.getHexString()}`,
      `#${deep.getHexString()}`,
    ]);
  if (kind === "rock") {
    flow(c, size, rnd, `#${accent.getHexString()}`, count(78), 16, 0.16);
    c.globalCompositeOperation = "multiply";
    flow(c, size, rnd, `#${deep.getHexString()}`, count(66), 22, 0.18);
  }
  if (kind === "ice") {
    flow(
      c,
      size,
      rnd,
      `#${white.clone().offsetHSL(0, -0.08, 0.08).getHexString()}`,
      count(95),
      12,
      0.2,
    );
    iceFissures(c, size, rnd);
  }
  if (kind === "volcanic") {
    flow(
      c,
      size,
      rnd,
      `#${brand.clone().offsetHSL(0, 0.08, 0.18).getHexString()}`,
      count(52),
      7,
      0.28,
    );
    lavaVeins(c, size, rnd, brand.clone().offsetHSL(0.02, 0.14, 0.24));
  }
  if (kind === "ocean") {
    flow(c, size, rnd, `#${white.getHexString()}`, count(65), 10, 0.14);
    atmosphericBands(
      c,
      size,
      rnd,
      [`#${white.getHexString()}`, `#${accent.getHexString()}`],
      rnd() > 0.55,
    );
  }
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = cloudCanvas.height = size;
  const q = cloudCanvas.getContext("2d")!;
  const hasCloud = style !== "standard" || kind !== "rock" || rnd() > 0.42;
  if (hasCloud) {
    const cloudDensity = 0.78 + rnd() * 0.48,
      cloudWidth = 0.72 + rnd() * 0.62;
    flow(
      q,
      size,
      rnd,
      "#ffffff",
      count(
        (style === "complex-bands" ? 155 : kind === "gas" ? 115 : 72) *
          cloudDensity,
      ),
      (style === "complex-bands" ? 10 : kind === "gas" ? 16 : 24) *
        cloudWidth,
      style === "complex-bands" ? 0.18 : kind === "volcanic" ? 0.1 : 0.24,
    );
    flow(
      q,
      size,
      rnd,
      `#${white.getHexString()}`,
      count(style === "complex-bands" ? 90 : 45),
      style === "complex-bands" ? 18 : 38,
      0.12,
    );
    if (style === "complex-bands")
      atmosphericBands(
        q,
        size,
        rnd,
        ["#ffffff", `#${white.getHexString()}`],
        true,
      );
    if (style === "storm")
      atmosphericBands(
        q,
        size,
        rnd,
        ["#ffffff", `#${white.getHexString()}`],
        true,
      );
  }
  blendHorizontalSeam(canvas);
  softenPolarCaps(canvas);
  if (hasCloud) {
    blendHorizontalSeam(cloudCanvas);
    softenPolarCaps(cloudCanvas, true);
  }
  const atmosphere = brand
    .clone()
    .lerp(new THREE.Color(0xffffff), kind === "ice" ? 0.62 : 0.38);
  return storeDesign(designKey, {
    surface: asTexture(canvas, aniso),
    clouds: hasCloud ? asTexture(cloudCanvas, aniso) : null,
    atmosphere,
    kind,
    cloudSpeed: 0.045 + rnd() * 0.095,
  });
}
