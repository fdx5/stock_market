import * as THREE from "three";

/* Number plates: 512 drawn once into an atlas (no download) — "123가 4567" and the older
 * "12가 3456", white with black characters for private cars (400), yellow for commercial
 * ones (taxis, trucks, buses: 112). Every vehicle in view gets its own. A plate quad takes
 * its plate from its instance colour (index = r·255 + g·255·256): the WebGPU view reads it
 * (ComplexRenderer PLATE), WebGL through the patch below. */

export const PLATE_COLS = 8, PLATE_ROWS = 64, PLATE_WHITE = 400, PLATE_COUNT = PLATE_COLS * PLATE_ROWS;
const HANGUL = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하", "구", "수", "거", "허"];

let atlas: THREE.CanvasTexture | null = null;
function plateAtlas() {
  if (atlas) return atlas;
  const CW = 224, CH = 48;
  const c = document.createElement("canvas");
  c.width = CW * PLATE_COLS; c.height = CH * PLATE_ROWS;
  const g = c.getContext("2d")!;
  let seed = 20260930;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");
  for (let i = 0; i < PLATE_COUNT; i++) {
    const x = (i % PLATE_COLS) * CW, y = Math.floor(i / PLATE_COLS) * CH;
    const yellow = i >= PLATE_WHITE;
    g.fillStyle = yellow ? "#f2c21b" : "#f6f6f2";
    g.fillRect(x + 2, y + 2, CW - 4, CH - 4);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 3;
    g.strokeRect(x + 4, y + 4, CW - 8, CH - 8);
    const text = `${digits(rnd() < 0.25 ? 2 : 3)}${HANGUL[Math.floor(rnd() * HANGUL.length)]} ${digits(4)}`;
    g.fillStyle = "#111111";
    g.font = `bold 34px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    // (squeezed to the plate's width, as the plate font is narrow)
    const w = g.measureText(text).width, k = Math.min(1, (CW - 26) / w);
    g.save(); g.translate(x + CW / 2, y + CH / 2 + 2); g.scale(k, 1); g.fillText(text, 0, 0); g.restore();
  }
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = false;
  atlas.anisotropy = 8;
  return atlas;
}

/** The plates' material (shared by every plate mesh of a traffic set). */
export function plateMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: plateAtlas(), roughness: 0.45, metalness: 0 });
  m.userData.plate = { cols: PLATE_COLS, rows: PLATE_ROWS };
  // WebGL: the cell from the instance colour, and no tint by it.
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_fragment>", `
        #ifdef USE_INSTANCING_COLOR
        float plateId = floor(vColor.r * 255.0 + 0.5) + 256.0 * floor(vColor.g * 255.0 + 0.5);
        #else
        float plateId = 0.0;
        #endif
        vec2 plateCell = vec2(mod(plateId, ${PLATE_COLS.toFixed(1)}), floor(plateId / ${PLATE_COLS.toFixed(1)}));
        vec4 plateTexel = texture2D(map, (plateCell + clamp(vMapUv, 0.01, 0.99)) / vec2(${PLATE_COLS.toFixed(1)}, ${PLATE_ROWS.toFixed(1)}));
        diffuseColor.rgb = plateTexel.rgb;`)
      .replace("#include <color_fragment>", "");
  };
  m.customProgramCacheKey = () => "plate";
  return m;
}

/** Front and rear plates (0.52 x 0.11 m) for a vehicle of length L, at heights yf, yr. */
export function plateGeometry(L: number, yf: number, yr: number, outF = 0.03, outR = 0.03) {
  const w = 0.26, h = 0.055, zf = L / 2 + outF, zr = -L / 2 - outR;
  // front faces +z, rear faces -z; uv (0, 0) at the plate's top left
  const pos = [
    -w, yf - h, zf, w, yf - h, zf, w, yf + h, zf, -w, yf + h, zf,
    w, yr - h, zr, -w, yr - h, zr, -w, yr + h, zr, w, yr + h, zr,
  ];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  return g;
}
