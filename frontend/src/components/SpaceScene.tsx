/* ============================================================================
   The hub's dynamic WebGL vignettes — Pluto -> the black hole, and the
   neutron binary — in one shared scene.
   ----------------------------------------------------------------------------
   Was two separate files, each mounting its own `<Canvas>` (see git history
   for PlutoScene.tsx/NeutronScene.tsx). Consolidated into one for two
   reasons that both showed up in testing: the neutron binary stopped
   rendering at all with two contexts running side by side (mobile Safari in
   particular caps how many simultaneous WebGL contexts it'll keep alive,
   and silently drops whichever one loses out under memory pressure — with
   only one context now, there's nothing to contend with), and running two
   independent R3F render loops was pure duplicated overhead neither scene
   needed on its own.

   Both DOM versions this replaced (see the git history further back) kept
   dropping frames on iPad even after several DOM-specific fixes — animating
   transform instead of top/left/right/bottom, gating per-frame work to only
   the seconds that actually need it, scoping an SVG clip-path to only the
   moment it mattered. The underlying ceiling was that each fragment/star was
   its own DOM node needing its own style recalculation and paint, and
   Safari/iPadOS tends to fall off hardware-accelerated compositing for a
   clipped or filtered, continuously-animating element. WebGL sidesteps that
   entirely: everything here is a handful of draw calls (one textured sphere,
   two small particle clouds, two glow sprites) with no DOM writes per frame
   at all — cheap regardless of how much detail is in the particle clouds,
   which is what let a first WebGL pass push Pluto's rock-chunk count from
   the DOM version's 16 up to 180. That first pass then turned out to still
   drop frames on iPad, for two compounding reasons fixed here: a real bug
   (THREE culls a Points cloud using its geometry's bounding sphere, which
   was only ever computed once — from the initial all-off-screen fill — and
   never updated afterward, so every fragment was silently invisible the
   whole time regardless of position) and, once fixed, genuine overdraw cost
   from 240 particles with heavy per-particle shader work. Both scenes'
   particle counts are cut substantially here in trade for actually hitting
   a real frame rate. */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** Local copy of the same small PRNG this file's siblings (Hub.tsx,
 * CelestialBody.tsx) each already keep their own of — see either one's own
 * note on why this isn't shared out into a module of its own. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keeps the default orthographic camera in plain screen-pixel coordinates
 * — (0, 0) at the canvas's top-left, Y increasing downward, one world unit
 * per CSS pixel — rather than Three's usual centred, Y-up convention. That
 * is what lets every position below reuse plain getBoundingClientRect()
 * numbers unchanged. Shared by both rigs below since they're now one scene. */
function ScreenSpaceCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.width;
    cam.top = 0;
    cam.bottom = size.height;
    cam.near = -1000;
    cam.far = 1000;
    cam.position.set(0, 0, 100);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** A soft round sprite (radial gradient baked into a small canvas) — point
 * sprites/THREE.Sprite are square by default; sampling this as alpha is
 * what makes them read as glowing motes instead of little tiles. Shared by
 * Pluto's debris and the neutron stars alike. */
function makeGlowSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
const GLOW_SPRITE = makeGlowSprite();

/* ═══════════════════════════════ pluto ═══════════════════════════════ */

/* gap is the live px distance from the black hole's own centre to Pluto's,
 * counting down from 300 at a 15px/s approach. Past 150px, destruction runs
 * as two distinct stages within a fixed 3 seconds total, per an explicit
 * request: first a 1-second "break" — chunks shed from the ~40% of the
 * disc actually facing the hole, the planet otherwise still sitting there
 * — and then a 2-second stretch: what's left elongates (spaghettification)
 * and sweeps one full lap around the hole, shrinking in as it goes, before
 * the last of it is absorbed. The black hole itself flares red for 2
 * seconds on absorption; then it all resets and repeats. */
const PLUTO_START_GAP = 300;
const PLUTO_SPEED = 15; // px/s, approach only
const PLUTO_TEAR_GAP = 150;
const PLUTO_BREAK_DURATION = 1; // the 40%-shatters burst
const PLUTO_STRETCH_DURATION = 2; // spaghettify + one lap around + absorb
const PLUTO_DESTROY_DURATION = PLUTO_BREAK_DURATION + PLUTO_STRETCH_DURATION;
const PLUTO_FLASH_HOLD = 2; // seconds — matches .hb-blackhole.is-feeding's hold

const PLUTO_TEAR_START = (PLUTO_START_GAP - PLUTO_TEAR_GAP) / PLUTO_SPEED; // 10s
const PLUTO_BREAK_END = PLUTO_TEAR_START + PLUTO_BREAK_DURATION; // 11s
const PLUTO_MOTION = PLUTO_TEAR_START + PLUTO_DESTROY_DURATION; // 13s — fully absorbed
const PLUTO_CYCLE = PLUTO_MOTION + PLUTO_FLASH_HOLD; // 15s, then it repeats

const PLUTO_STRETCH_MAX = 3.2;
const PLUTO_SQUASH_MAX = 0.82;
const PLUTO_SPIN_SECONDS = 17;

interface PlutoFragment {
  kind: "chunk" | "dust";
  activateAt: number; // 0..1 within its own sub-window (break for chunks, stretch for dust)
  life: number;
  size: number;
  angleDeg: number;
  fling: number;
  startR: number;
  turns: number;
  startTheta: number;
}

// 35 pieces total (25 chunks + 10 dust) — cut down hard from an earlier
// 240 (180 + 60, then 55), which was cheap to draw call-wise (still just
// two Points clouds) but genuinely expensive fragment-shader/overdraw work
// once the culling bug above was fixed and they actually started
// rendering. Erring conservative here given iPad frame rate is still the
// open problem.
const PLUTO_CHUNK_COUNT = 25;
const PLUTO_DUST_COUNT = 10;
/** Chunks only ever shed from this many degrees of the disc — the ~40% of
 * it actually facing the hole (0deg = straight at the hole from wherever
 * Pluto currently is) — per an explicit request ("우측 40%가 파괴"). 144deg
 * is exactly 40% of a full circle. */
const PLUTO_BREAK_ARC_DEG = 144;

const PLUTO_FRAGMENTS: PlutoFragment[] = (() => {
  const rand = mulberry32(31337);
  const list: PlutoFragment[] = [];
  for (let i = 0; i < PLUTO_CHUNK_COUNT; i += 1) {
    list.push({
      kind: "chunk",
      activateAt: Math.min(1, (i / PLUTO_CHUNK_COUNT) * 0.8 + rand() * 0.2),
      life: 0.5 + rand() * 0.6,
      size: 5 + rand() * 8,
      angleDeg: (rand() - 0.5) * PLUTO_BREAK_ARC_DEG,
      fling: 12 + rand() * 24,
      startR: 0,
      turns: 0,
      startTheta: 0,
    });
  }
  for (let i = 0; i < PLUTO_DUST_COUNT; i += 1) {
    list.push({
      kind: "dust",
      activateAt: Math.min(1, (i / PLUTO_DUST_COUNT) * 0.6 + rand() * 0.18),
      life: 0.4 + rand() * 0.45,
      size: 2.5 + rand() * 3,
      angleDeg: 0,
      fling: 0,
      startR: 0.3 + rand() * 0.6,
      turns: 2.2 + rand() * 2.6,
      startTheta: rand() * Math.PI * 2,
    });
  }
  return list;
})();
const PLUTO_CHUNKS = PLUTO_FRAGMENTS.filter((f) => f.kind === "chunk");
const PLUTO_DUST = PLUTO_FRAGMENTS.filter((f) => f.kind === "dust");

/** Restarts `.hb-blackhole`'s red flare — see .hb-blackhole.is-feeding in
 * hub.css. */
function fireBlackHoleFeed(el: HTMLElement | null) {
  if (!el) return;
  el.classList.add("is-feeding");
  window.setTimeout(() => {
    el.classList.remove("is-feeding");
  }, PLUTO_FLASH_HOLD * 1000);
}

/* Per-particle size and opacity aren't something the built-in
   THREE.PointsMaterial can vary (its `size`/`opacity` are single uniforms
   for the whole cloud) — this tiny custom material is what lets each point
   carry its own, so fragments can fade in/out and vary in size
   individually while still rendering as one draw call. */
const PARTICLE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aOpacity;
  varying float vOpacity;
  void main() {
    vOpacity = aOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const PARTICLE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform sampler2D uSprite;
  varying float vOpacity;
  void main() {
    vec4 tex = texture2D(uSprite, gl_PointCoord);
    gl_FragColor = vec4(uColor, vOpacity) * tex;
  }
`;

function makeParticleGeometry(count: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3).fill(-99999);
  const sizes = new Float32Array(count).fill(0);
  const opacities = new Float32Array(count).fill(0);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage));
  return geo;
}

interface PlutoRigProps {
  blackHoleRef: React.RefObject<HTMLButtonElement>;
}

function PlutoRig({ blackHoleRef }: PlutoRigProps) {
  const texture = useLoader(THREE.TextureLoader, "/img/planets/pluto.webp");
  const meshRef = useRef<THREE.Mesh>(null!);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const chunkGeo = useMemo(() => makeParticleGeometry(PLUTO_CHUNK_COUNT), []);
  const dustGeo = useMemo(() => makeParticleGeometry(PLUTO_DUST_COUNT), []);
  const chunkUniforms = useMemo(() => ({ uColor: { value: new THREE.Color("#c99a6a") }, uSprite: { value: GLOW_SPRITE } }), []);
  const dustUniforms = useMemo(() => ({ uColor: { value: new THREE.Color("#ffdca0") }, uSprite: { value: GLOW_SPRITE } }), []);

  // Mutable, non-reactive playback state — none of this needs to trigger a
  // re-render, so it lives in a plain ref rather than useState.
  const state = useRef({
    startedAt: performance.now(),
    fired: false,
    bhCenterX: 0,
    bhCenterY: 0,
    plutoRadius: 40,
  });

  useEffect(() => {
    const measure = () => {
      const bhEl = blackHoleRef.current;
      if (!bhEl) return;
      const bhRect = bhEl.getBoundingClientRect();
      // Plain viewport-absolute coordinates — this scene's canvas covers
      // the full viewport (see .hb-space-canvas in hub.css), so there's no
      // separate local-space offset to subtract. plutoRadius is computed
      // straight from the viewport (half of Mars's own `68 * --body-unit`
      // size expression — see PLANETS in Hub.tsx) rather than measured off
      // a separate probe `<div>`, for the same reason computeNeutronAnchor
      // replaced a DOM-measured one: one fewer element whose own CSS
      // positioning context this could silently drift out of sync with.
      state.current.bhCenterX = bhRect.left + bhRect.width / 2;
      state.current.bhCenterY = bhRect.top + bhRect.height / 2;
      state.current.plutoRadius = 34 * computeBodyUnitPx();
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [blackHoleRef]);

  useFrame((_, delta) => {
    const s = state.current;
    const elapsed = (performance.now() - s.startedAt) / 1000;
    const cycleElapsed = elapsed % PLUTO_CYCLE;
    const R = s.plutoRadius;

    let plutoCenterX: number;
    let plutoCenterY: number;
    let stretchX = 1;
    let squashY = 1;
    let bodyOpacity = 1;
    // The angle (radians) chunks measure their own angleDeg from — "0deg"
    // always means "pointing straight at the hole from wherever Pluto
    // currently is", so the break burst always sheds from the hole-facing
    // side even once that side stops being simply "east" during the swirl.
    let faceAngle = 0;

    if (cycleElapsed < PLUTO_TEAR_START) {
      // Approach: straight line in from the west at a constant 15px/s.
      const gap = PLUTO_START_GAP - PLUTO_SPEED * cycleElapsed;
      plutoCenterX = s.bhCenterX - gap;
      plutoCenterY = s.bhCenterY;
      faceAngle = 0; // due east — the hole is directly to the right
    } else if (cycleElapsed < PLUTO_BREAK_END) {
      // Break: holds at the 150px mark while ~40% of the disc (the side
      // facing the hole) sheds as chunks — see PLUTO_BREAK_ARC_DEG.
      plutoCenterX = s.bhCenterX - PLUTO_TEAR_GAP;
      plutoCenterY = s.bhCenterY;
      faceAngle = 0;
    } else {
      // Stretch: a straight pull the rest of the way into the hole's
      // centre — no more sweeping a lap around it first, per an explicit
      // request to remove that — elongating (spaghettification) along
      // that same straight line as it closes the remaining 150px.
      const u = Math.min(1, (cycleElapsed - PLUTO_BREAK_END) / PLUTO_STRETCH_DURATION);
      const remaining = PLUTO_TEAR_GAP * (1 - u);
      plutoCenterX = s.bhCenterX - remaining;
      plutoCenterY = s.bhCenterY;
      faceAngle = 0;
      stretchX = 1 + u * PLUTO_STRETCH_MAX;
      squashY = 1 - u * PLUTO_SQUASH_MAX;
      bodyOpacity = u < 0.82 ? 1 : Math.max(0, 1 - (u - 0.82) / 0.18);
    }

    const mesh = meshRef.current;
    if (mesh) {
      // Stretch axis follows faceAngle (always due east/+X here, since the
      // whole approach/break/stretch sequence is one straight line into
      // the hole) rather than a tangent — there's no orbital sweep left to
      // be tangent to. During approach/break, stretchX is 1 (a no-op), so
      // the offset there is a harmless no-op too.
      mesh.position.set(plutoCenterX + Math.cos(faceAngle) * R * (stretchX - 1), plutoCenterY + Math.sin(faceAngle) * R * (stretchX - 1), 0);
      mesh.scale.set(R * stretchX, R * squashY, R * squashY);
      mesh.rotation.y += (delta * (Math.PI * 2)) / PLUTO_SPIN_SECONDS;
      mesh.visible = bodyOpacity > 0.01;
    }
    if (materialRef.current) materialRef.current.opacity = bodyOpacity;

    updateChunks(chunkGeo, cycleElapsed, s.bhCenterX, s.bhCenterY, plutoCenterX, plutoCenterY, R, faceAngle);
    updateDust(dustGeo, cycleElapsed, s.bhCenterX, s.bhCenterY);

    if (cycleElapsed >= PLUTO_MOTION) {
      if (!s.fired) {
        s.fired = true;
        fireBlackHoleFeed(blackHoleRef.current);
      }
    } else if (cycleElapsed < 0.5) {
      s.fired = false;
    }
  });

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial ref={materialRef} map={texture} transparent toneMapped={false} />
      </mesh>
      {/* frustumCulled={false} on both: THREE culls a Points object using
          its geometry's bounding sphere, which is otherwise only ever
          (re)computed once — from makeParticleGeometry's initial
          all-off-screen fill — and never updated as updateChunks/updateDust
          move points afterward, so the whole cloud stayed classified as
          outside the frustum and was silently never drawn, regardless of
          where the particles actually were. Disabling culling is simpler
          and cheaper than recomputing that sphere every frame, and correct
          here regardless — the cloud is always a small, known region near
          the black hole, never large enough for culling to actually save
          anything. */}
      <points geometry={chunkGeo} frustumCulled={false}>
        <shaderMaterial vertexShader={PARTICLE_VERTEX_SHADER} fragmentShader={PARTICLE_FRAGMENT_SHADER} uniforms={chunkUniforms} transparent depthWrite={false} />
      </points>
      <points geometry={dustGeo} frustumCulled={false}>
        <shaderMaterial
          vertexShader={PARTICLE_VERTEX_SHADER}
          fragmentShader={PARTICLE_FRAGMENT_SHADER}
          uniforms={dustUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

/** Chunks: a quadratic-bezier tidal sling from the disc's hole-facing rim,
 * bulging outward before curving in to the hole's centre. All 40 activate
 * within the 1-second break window (see PLUTO_BREAK_END), each at its own
 * angle within the ~40% arc facing the hole (faceAngle +/- half of
 * PLUTO_BREAK_ARC_DEG) — the "우측 40%가 파괴" burst. */
function updateChunks(
  geo: THREE.BufferGeometry,
  cycleElapsed: number,
  bhCenterX: number,
  bhCenterY: number,
  plutoCenterX: number,
  plutoCenterY: number,
  plutoRadius: number,
  faceAngle: number
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const size = geo.attributes.aSize as THREE.BufferAttribute;
  const opacity = geo.attributes.aOpacity as THREE.BufferAttribute;

  for (let i = 0; i < PLUTO_CHUNKS.length; i += 1) {
    const frag = PLUTO_CHUNKS[i];
    const activateElapsed = PLUTO_TEAR_START + frag.activateAt * PLUTO_BREAK_DURATION;
    const t = (cycleElapsed - activateElapsed) / frag.life;

    if (t < 0 || t > 1) {
      if (opacity.getX(i) !== 0) {
        opacity.setX(i, 0);
        pos.setXYZ(i, -99999, -99999, 0);
      }
      continue;
    }

    const rad = faceAngle + (frag.angleDeg * Math.PI) / 180;
    const rimX = plutoCenterX + plutoRadius * Math.cos(rad);
    const rimY = plutoCenterY + plutoRadius * Math.sin(rad);
    const outX = rimX + Math.cos(rad) * frag.fling;
    const outY = rimY + Math.sin(rad) * frag.fling;
    const eased = t * t * (3 - 2 * t);
    const mt = 1 - eased;
    const x = mt * mt * rimX + 2 * mt * eased * outX + eased * eased * bhCenterX;
    const y = mt * mt * rimY + 2 * mt * eased * outY + eased * eased * bhCenterY;
    const op = t < 0.12 ? t / 0.12 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
    pos.setXYZ(i, x, y, 0);
    size.setX(i, frag.size * (1 - 0.4 * eased));
    opacity.setX(i, op);
  }

  pos.needsUpdate = true;
  size.needsUpdate = true;
  opacity.needsUpdate = true;
}

/** Dust: a polar spiral straight into the hole's own centre, radius
 * shrinking while the angle winds up as t^2 so the spin visibly
 * accelerates near the centre — "water down a drain". Activates during
 * the 2-second stretch+swirl window, alongside the elongating core. */
function updateDust(geo: THREE.BufferGeometry, cycleElapsed: number, bhCenterX: number, bhCenterY: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const size = geo.attributes.aSize as THREE.BufferAttribute;
  const opacity = geo.attributes.aOpacity as THREE.BufferAttribute;

  for (let i = 0; i < PLUTO_DUST.length; i += 1) {
    const frag = PLUTO_DUST[i];
    const activateElapsed = PLUTO_BREAK_END + frag.activateAt * PLUTO_STRETCH_DURATION;
    const t = (cycleElapsed - activateElapsed) / frag.life;

    if (t < 0 || t > 1) {
      if (opacity.getX(i) !== 0) {
        opacity.setX(i, 0);
        pos.setXYZ(i, -99999, -99999, 0);
      }
      continue;
    }

    const r0 = frag.startR * 60;
    const r = r0 * (1 - t);
    const theta = frag.startTheta + frag.turns * Math.PI * 2 * (t * t);
    const x = bhCenterX + r * Math.cos(theta);
    const y = bhCenterY + r * Math.sin(theta);
    const op = t < 0.1 ? t / 0.1 : t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    pos.setXYZ(i, x, y, 0);
    size.setX(i, frag.size);
    opacity.setX(i, op);
  }

  pos.needsUpdate = true;
  size.needsUpdate = true;
  opacity.needsUpdate = true;
}

/* ═══════════════════════════════ neutron binary ═══════════════════════════════ */

const NEUTRON_ANCHORS: Record<string, { amp: number; glow: number }> = {
  "5": { amp: 22, glow: 1.0 },
  "4": { amp: 19, glow: 1.1 },
  "3": { amp: 16, glow: 1.25 },
  "2": { amp: 13, glow: 1.4 },
  "1": { amp: 10, glow: 1.6 },
  "0.5": { amp: 7, glow: 1.8 },
  "0.2": { amp: 5, glow: 2.0 },
};

interface NeutronStage {
  period: number;
  laps: number;
}

const NEUTRON_STAGES: NeutronStage[] = [
  { period: 5, laps: 2 },
  { period: 4, laps: 2 },
  { period: 3, laps: 2 },
  { period: 2, laps: 2 },
  { period: 1, laps: 2 },
  { period: 0.5, laps: 4 },
  { period: 0.2, laps: 6 },
];

const NEUTRON_MERGE_DURATION = 0.45;
const NEUTRON_MERGE_GLOW = 2.6;
const NEUTRON_MERGE_SCALE = 1.55;
const NEUTRON_HOLD_DURATION = 2;
const NEUTRON_STAR_SIZE_UNITS = 15;
const NEUTRON_CONTAINER_UNITS = 64;

function clampNum(min: number, val: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/** Mirrors --orbit-unit/--body-unit's own clamp() formula in hub.css
 * exactly, so this scene's sizing tracks the same responsive scale as
 * every other body on the page without needing to read it back out of the
 * DOM (a custom property's own calc()/clamp() doesn't resolve to a plain
 * number through getComputedStyle — there's no clean way to read it back,
 * only to recompute it). */
function computeBodyUnitPx(): number {
  const orbitUnit = clampNum(0.2, Math.min((window.innerHeight - 380) / 762, (window.innerWidth - 250) / 1334), 1.3);
  return orbitUnit * 1.26;
}

/** Where the neutron binary sits — mirrors .hb-neutron-canvas's own
 * top/right/width/height in hub.css exactly, computed straight from the
 * viewport instead of measured off a DOM element. An earlier pass measured
 * a positioned `<div>` via getBoundingClientRect() instead; that div had
 * been moved to a different spot in the DOM tree than `.hb-neutron-canvas`'s
 * CSS assumed (a different `position: absolute` containing block), which
 * silently placed the whole binary off in the wrong spot — computing this
 * directly removes that whole class of bug, since there's no longer a DOM
 * element's own position this can drift out of sync with. */
function computeNeutronAnchor(): { centerX: number; centerY: number; pxPerUnit: number } {
  const bodyUnit = computeBodyUnitPx();
  const topPx = clampNum(92, window.innerHeight * 0.13, 172);
  const rightPx = clampNum(54, window.innerWidth * 0.09, 150);
  const widthPx = NEUTRON_CONTAINER_UNITS * bodyUnit;
  const heightPx = 18 * bodyUnit;
  return {
    centerX: window.innerWidth - rightPx - widthPx / 2,
    centerY: topPx + heightPx / 2,
    pxPerUnit: bodyUnit,
  };
}

/** Restarts `.hb-neutron-flash`'s burst animation — remove+reflow+add
 * rather than just add, since the class may already be present (holding
 * its post-animation resting state) from a previous merge. */
function fireNeutronFlash(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("is-flashing");
  void el.offsetWidth;
  el.classList.add("is-flashing");
}

interface NeutronRigProps {
  flashRef: React.RefObject<HTMLDivElement>;
}

function NeutronRig({ flashRef }: NeutronRigProps) {
  const starARef = useRef<THREE.Sprite>(null!);
  const starBRef = useRef<THREE.Sprite>(null!);

  const state = useRef({
    mode: "orbit" as "orbit" | "merge" | "hold",
    stageIndex: 0,
    stageElapsed: 0,
    mergeElapsed: 0,
    holdElapsed: 0,
    ampAtMergeStart: 0,
    phase: 0,
    amp: NEUTRON_ANCHORS["5"].amp,
    glow: NEUTRON_ANCHORS["5"].glow,
    mscale: 1,
    pxPerUnit: 1,
    centerX: 0,
    centerY: 0,
  });

  useEffect(() => {
    const measure = () => {
      const { centerX, centerY, pxPerUnit } = computeNeutronAnchor();
      state.current.centerX = centerX;
      state.current.centerY = centerY;
      state.current.pxPerUnit = pxPerUnit;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useFrame((_, delta) => {
    const s = state.current;
    const dt = Math.min(delta, 0.1);

    if (s.mode === "orbit") {
      s.stageElapsed += dt;
      let stage = NEUTRON_STAGES[s.stageIndex];
      let stageDuration = stage.period * stage.laps;
      while (s.stageElapsed >= stageDuration) {
        s.stageElapsed -= stageDuration;
        s.stageIndex += 1;
        if (s.stageIndex >= NEUTRON_STAGES.length) {
          s.mode = "merge";
          s.mergeElapsed = 0;
          s.ampAtMergeStart = s.amp;
          break;
        }
        stage = NEUTRON_STAGES[s.stageIndex];
        stageDuration = stage.period * stage.laps;
      }
      if (s.mode === "orbit") {
        const target = NEUTRON_ANCHORS[String(stage.period)];
        const ease = 1 - Math.exp(-dt / 0.35);
        s.amp += (target.amp - s.amp) * ease;
        s.glow += (target.glow - s.glow) * ease;
        s.mscale += (1 - s.mscale) * ease;
        s.phase += ((2 * Math.PI) / stage.period) * dt;
      }
    }

    if (s.mode === "merge") {
      s.mergeElapsed += dt;
      const t = Math.min(s.mergeElapsed / NEUTRON_MERGE_DURATION, 1);
      const eased = t * t * (3 - 2 * t);
      s.amp = s.ampAtMergeStart * (1 - eased);
      s.glow += (NEUTRON_MERGE_GLOW - s.glow) * (1 - Math.exp(-dt / 0.15));
      s.mscale += (NEUTRON_MERGE_SCALE - s.mscale) * (1 - Math.exp(-dt / 0.2));
      s.phase += ((2 * Math.PI) / 0.2) * dt;
      if (t >= 1) {
        s.amp = 0;
        s.mode = "hold";
        s.holdElapsed = 0;
        fireNeutronFlash(flashRef.current);
      }
    } else if (s.mode === "hold") {
      s.holdElapsed += dt;
      s.amp = 0;
      s.glow += (NEUTRON_MERGE_GLOW - s.glow) * (1 - Math.exp(-dt / 0.3));
      if (s.holdElapsed >= NEUTRON_HOLD_DURATION) {
        s.mode = "orbit";
        s.stageIndex = 0;
        s.stageElapsed = 0;
      }
    }

    const nxPx = s.amp * Math.cos(s.phase) * s.pxPerUnit;
    const sizePx = NEUTRON_STAR_SIZE_UNITS * s.pxPerUnit * s.mscale;

    const a = starARef.current;
    const b = starBRef.current;
    if (a) {
      a.position.set(s.centerX + nxPx, s.centerY, 0);
      a.scale.set(sizePx, sizePx, 1);
      (a.material as THREE.SpriteMaterial).color.setScalar(s.glow);
    }
    if (b) {
      b.position.set(s.centerX - nxPx, s.centerY, 0);
      b.scale.set(sizePx, sizePx, 1);
      (b.material as THREE.SpriteMaterial).color.setScalar(s.glow);
    }
  });

  return (
    <>
      <sprite ref={starARef} frustumCulled={false}>
        <spriteMaterial map={GLOW_SPRITE} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={starBRef} frustumCulled={false}>
        <spriteMaterial map={GLOW_SPRITE} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
}

/* ═══════════════════════════════ mount ═══════════════════════════════ */

/** Skipped under reduced motion — same convention every other rAF/useFrame
 * effect on this page follows. Deliberately NOT gated on touch/coarse-
 * pointer (which would exclude iPad): the entire point of the move to
 * WebGL was to make this run smoothly on the device that kept dropping
 * frames, not to hide it there instead. */
function useSpaceSceneEnabled(): boolean {
  const enabled = useRef(true);
  if (typeof window !== "undefined") {
    enabled.current = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return enabled.current;
}

export default function SpaceScene({
  blackHoleRef,
  neutronFlashRef,
}: {
  blackHoleRef: React.RefObject<HTMLButtonElement>;
  neutronFlashRef: React.RefObject<HTMLDivElement>;
}) {
  const enabled = useSpaceSceneEnabled();

  return (
    <>
      {enabled && (
        <div className="hb-space-canvas" aria-hidden="true">
          {/* antialias off, dpr fixed at 1 (not even a [1, x] range): MSAA
              plus a high device-pixel-ratio full-screen canvas is real
              fill-rate cost every frame, and iPad's GPU (commonly DPR 2-3)
              felt it. The soft circular sprite every particle already uses
              anti-aliases their own edges regardless of MSAA. */}
          <Canvas orthographic gl={{ alpha: true, antialias: false }} dpr={1}>
            <ScreenSpaceCamera />
            <PlutoRig blackHoleRef={blackHoleRef} />
            <NeutronRig flashRef={neutronFlashRef} />
          </Canvas>
        </div>
      )}
    </>
  );
}
