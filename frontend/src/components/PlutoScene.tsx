/* ============================================================================
   Pluto -> the black hole, in WebGL.
   ----------------------------------------------------------------------------
   Replaces an earlier DOM/CSS version of this same vignette (a Mars-sized
   Pluto drifting in from the black hole's left, tearing apart, and being
   absorbed — see the git history for that pass). That version animated up to
   40 individually-styled `<span>` fragments plus an SVG clip-path on the
   planet's own disc, all driven by direct per-frame style writes; on iPad it
   still dropped frames even after the DOM-specific fixes (animating
   transform instead of `right`, gating the work to the ~4s destroy window,
   scoping the clip-path to only that window) — the underlying ceiling is
   that each fragment is its own DOM node needing its own style
   recalculation and paint, and Safari/iPadOS in particular tends to fall off
   hardware-accelerated compositing for a clipped, moving element.

   This version renders the whole thing as one small WebGL scene instead: the
   planet is a single textured sphere, and the debris (chunks + dust) are two
   THREE.Points clouds — each its own single draw call no matter how many
   particles it holds, with per-particle size/opacity driven by a small
   custom shader (see CHUNK_VERTEX_SHADER/FRAGMENT_SHADER below) rather than
   by touching the DOM at all. Particle count can afford to be generous here
   (240 total) in a way 40 DOM nodes couldn't.

   One simplification versus the DOM version: the planet's own disc no
   longer tears along a jagged clip-path boundary — it just stretches
   (spaghettification — see PLUTO_STRETCH_MAX/SQUASH_MAX) and fades while
   the chunk cloud sheds from it. That reads as "coming apart" plenty on its
   own, and re-deriving a per-pixel erosion shader wasn't worth the added
   GPU work this whole rewrite exists to avoid. */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ───────────────────────────── timeline ─────────────────────────────
   Same numbers (and the same reasoning) as the DOM version this replaces:
   gap is the live px distance from the black hole's own centre to Pluto's,
   counting down from 300 at a 15px/s approach; past 150px the destruction
   sequence starts and always finishes within a fixed 3 seconds regardless
   of the approach speed; the black hole itself flares red for 2 seconds on
   absorption; then it all resets and repeats. */
const PLUTO_START_GAP = 300;
const PLUTO_SPEED = 15; // px/s, approach only
const PLUTO_TEAR_GAP = 150;
const PLUTO_DESTROY_DURATION = 3;
const PLUTO_FLASH_HOLD = 2; // seconds — matches .hb-blackhole.is-feeding's hold

const PLUTO_TEAR_LEN = PLUTO_DESTROY_DURATION * (4 / 7); // ~1.71s
const PLUTO_SWIRL_LEN = PLUTO_DESTROY_DURATION - PLUTO_TEAR_LEN; // ~1.29s
const PLUTO_TEAR_START = (PLUTO_START_GAP - PLUTO_TEAR_GAP) / PLUTO_SPEED; // 10s
const PLUTO_SWIRL_START = PLUTO_TEAR_START + PLUTO_TEAR_LEN;
const PLUTO_MOTION = PLUTO_TEAR_START + PLUTO_DESTROY_DURATION; // gap hits 0 here
const PLUTO_CYCLE = PLUTO_MOTION + PLUTO_FLASH_HOLD;

const PLUTO_STRETCH_MAX = 3.2;
const PLUTO_SQUASH_MAX = 0.82;

const PLUTO_SPIN_SECONDS = 17; // one full rotation, same speed the DOM version used

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

interface PlutoFragment {
  kind: "chunk" | "dust";
  activateAt: number;
  life: number;
  size: number;
  angleDeg: number;
  fling: number;
  startR: number;
  turns: number;
  startTheta: number;
}

// 240 pieces total (180 chunks + 60 dust) — well past the 90+ asked for
// originally, and no longer capped by DOM-node cost the way the CSS version
// was: both clouds render in one draw call each regardless of count.
const PLUTO_CHUNK_COUNT = 180;
const PLUTO_DUST_COUNT = 60;

const PLUTO_FRAGMENTS: PlutoFragment[] = (() => {
  const rand = mulberry32(31337);
  const list: PlutoFragment[] = [];
  for (let i = 0; i < PLUTO_CHUNK_COUNT; i += 1) {
    list.push({
      kind: "chunk",
      activateAt: Math.min(1, (i / PLUTO_CHUNK_COUNT) * 0.85 + rand() * 0.18),
      life: 0.5 + rand() * 0.6,
      size: 5 + rand() * 8,
      angleDeg: -75 + rand() * 150,
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
 * hub.css. Local copy of the same tiny helper the DOM version used; kept
 * here since this file now owns the whole Pluto timeline that decides when
 * to call it. */
function fireBlackHoleFeed(el: HTMLElement | null) {
  if (!el) return;
  el.classList.add("is-feeding");
  window.setTimeout(() => {
    el.classList.remove("is-feeding");
  }, PLUTO_FLASH_HOLD * 1000);
}

/** A soft round sprite (radial gradient baked into a small canvas) — point
 * sprites are square by default; sampling this as each point's alpha is
 * what makes them read as glowing motes instead of little tiles. Built
 * once, module scope — every points material shares this one texture. */
const PARTICLE_SPRITE = (() => {
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
})();

/* Per-particle size and opacity aren't something the built-in
   THREE.PointsMaterial can vary (its `size`/`opacity` are single uniforms
   for the whole cloud) — this tiny custom material is what lets each of
   the 240 points carry its own, so fragments can fade in/out and vary in
   size individually while still rendering as one draw call. */
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

/** Keeps the default orthographic camera in plain screen-pixel coordinates
 * — (0, 0) at the canvas's top-left, Y increasing downward, one world unit
 * per CSS pixel — rather than Three's usual centred, Y-up convention. That
 * is what lets every position below reuse the exact same
 * getBoundingClientRect()-based numbers the DOM version used, unchanged. */
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

interface PlutoRigProps {
  blackHoleRef: React.RefObject<HTMLButtonElement>;
  probeRef: React.RefObject<HTMLDivElement>;
  wrapRef: React.RefObject<HTMLDivElement>;
}

function PlutoRig({ blackHoleRef, probeRef, wrapRef }: PlutoRigProps) {
  const texture = useLoader(THREE.TextureLoader, "/img/planets/pluto.webp");
  const meshRef = useRef<THREE.Mesh>(null!);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null!);
  const chunkGeo = useMemo(() => makeParticleGeometry(PLUTO_CHUNK_COUNT), []);
  const dustGeo = useMemo(() => makeParticleGeometry(PLUTO_DUST_COUNT), []);

  // Mutable, non-reactive playback state — same reasoning as every other
  // rAF-driven effect on this page (see Hub.tsx's useNeutronBinary): none
  // of this needs to trigger a re-render, so it lives in a plain ref rather
  // than useState.
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
      const probeEl = probeRef.current;
      const wrapEl = wrapRef.current;
      if (!bhEl || !probeEl || !wrapEl) return;
      const bhRect = bhEl.getBoundingClientRect();
      const probeRect = probeEl.getBoundingClientRect();
      const wrapRect = wrapEl.getBoundingClientRect();
      // Converted into the canvas's own local space (subtracting the
      // wrapper's own viewport offset) right here, the one place that
      // matters, rather than at every site below that reads bhCenterX/Y —
      // see .hb-pluto-canvas in hub.css for why the canvas is a small
      // bounded box near the hole rather than the full viewport now.
      state.current.bhCenterX = bhRect.left + bhRect.width / 2 - wrapRect.left;
      state.current.bhCenterY = bhRect.top + bhRect.height / 2 - wrapRect.top;
      state.current.plutoRadius = probeRect.width / 2;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [blackHoleRef, probeRef, wrapRef]);

  useFrame((_, delta) => {
    const s = state.current;
    const elapsed = (performance.now() - s.startedAt) / 1000;
    const cycleElapsed = elapsed % PLUTO_CYCLE;

    let gap: number;
    if (cycleElapsed < PLUTO_TEAR_START) {
      gap = PLUTO_START_GAP - PLUTO_SPEED * cycleElapsed;
    } else if (cycleElapsed < PLUTO_MOTION) {
      gap = PLUTO_TEAR_GAP * (1 - (cycleElapsed - PLUTO_TEAR_START) / PLUTO_DESTROY_DURATION);
    } else {
      gap = 0;
    }
    gap = Math.min(PLUTO_START_GAP, Math.max(0, gap));

    const plutoCenterX = s.bhCenterX - gap;
    const plutoCenterY = s.bhCenterY;
    const R = s.plutoRadius;

    const p1 = Math.min(1, Math.max(0, (cycleElapsed - PLUTO_TEAR_START) / PLUTO_TEAR_LEN));

    // Spaghettification: stretch out toward the hole (+X), thin vertically,
    // fade over the last 20% of the tear window. Shifting position.x by
    // the added half-length is what keeps the trailing edge anchored while
    // the leading edge reaches into the hole, instead of stretching
    // symmetrically from the centre.
    const stretchX = 1 + p1 * PLUTO_STRETCH_MAX;
    const squashY = 1 - p1 * PLUTO_SQUASH_MAX;
    const bodyOpacity = p1 < 0.8 ? 1 : Math.max(0, 1 - (p1 - 0.8) / 0.2);

    const mesh = meshRef.current;
    if (mesh) {
      mesh.position.set(plutoCenterX + R * (stretchX - 1), plutoCenterY, 0);
      mesh.scale.set(R * stretchX, R * squashY, R * squashY);
      mesh.rotation.y += (delta * (Math.PI * 2)) / PLUTO_SPIN_SECONDS;
      mesh.visible = bodyOpacity > 0.01;
    }
    if (materialRef.current) materialRef.current.opacity = bodyOpacity;

    updateParticles(chunkGeo, PLUTO_CHUNKS, cycleElapsed, s.bhCenterX, s.bhCenterY, plutoCenterX, plutoCenterY, R, "chunk");
    updateParticles(dustGeo, PLUTO_DUST, cycleElapsed, s.bhCenterX, s.bhCenterY, plutoCenterX, plutoCenterY, R, "dust");

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
        <sphereGeometry args={[1, 40, 40]} />
        <meshBasicMaterial ref={materialRef} map={texture} transparent toneMapped={false} />
      </mesh>
      {/* frustumCulled={false} on both: THREE computes a Points object's
          culling bounds from its geometry's bounding sphere, which is
          otherwise only ever (re)computed once, from makeParticleGeometry's
          initial all-off-screen (-99999, -99999) fill — every position
          written afterward in updateParticles moves points without ever
          updating that stale sphere, so the whole cloud silently stayed
          classified as outside the view frustum and was never drawn at
          all. Disabling culling is simpler and cheaper than recomputing the
          bounding sphere every frame, and correct here regardless — the
          cloud is always a small, known region near the black hole, never
          large enough for culling to actually save anything. */}
      <points geometry={chunkGeo} frustumCulled={false}>
        <shaderMaterial
          vertexShader={PARTICLE_VERTEX_SHADER}
          fragmentShader={PARTICLE_FRAGMENT_SHADER}
          uniforms={useMemo(
            () => ({ uColor: { value: new THREE.Color("#c99a6a") }, uSprite: { value: PARTICLE_SPRITE } }),
            []
          )}
          transparent
          depthWrite={false}
        />
      </points>
      <points geometry={dustGeo} frustumCulled={false}>
        <shaderMaterial
          vertexShader={PARTICLE_VERTEX_SHADER}
          fragmentShader={PARTICLE_FRAGMENT_SHADER}
          uniforms={useMemo(
            () => ({ uColor: { value: new THREE.Color("#ffdca0") }, uSprite: { value: PARTICLE_SPRITE } }),
            []
          )}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

/** Writes this frame's position/size/opacity for one fragment cloud
 * straight into its BufferGeometry's attributes — no per-fragment object
 * allocation, no DOM. Chunks fly a bezier from Pluto's rim (bulging
 * outward through a tidal-sling control point) into the hole's centre;
 * dust spirals in around the hole directly, radius shrinking and angle
 * winding up as t^2 so the spin visibly accelerates near the centre. */
function updateParticles(
  geo: THREE.BufferGeometry,
  frags: PlutoFragment[],
  cycleElapsed: number,
  bhCenterX: number,
  bhCenterY: number,
  plutoCenterX: number,
  plutoCenterY: number,
  plutoRadius: number,
  kind: "chunk" | "dust"
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const size = geo.attributes.aSize as THREE.BufferAttribute;
  const opacity = geo.attributes.aOpacity as THREE.BufferAttribute;

  for (let i = 0; i < frags.length; i += 1) {
    const frag = frags[i];
    const activateElapsed =
      kind === "chunk" ? PLUTO_TEAR_START + frag.activateAt * PLUTO_TEAR_LEN : PLUTO_SWIRL_START + frag.activateAt * PLUTO_SWIRL_LEN;
    const t = (cycleElapsed - activateElapsed) / frag.life;

    if (t < 0 || t > 1) {
      if (opacity.getX(i) !== 0) {
        opacity.setX(i, 0);
        pos.setXYZ(i, -99999, -99999, 0);
      }
      continue;
    }

    if (kind === "chunk") {
      const rad = (frag.angleDeg * Math.PI) / 180;
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
    } else {
      const r0 = frag.startR * plutoRadius;
      const r = r0 * (1 - t);
      const theta = frag.startTheta + frag.turns * Math.PI * 2 * (t * t);
      const x = bhCenterX + r * Math.cos(theta);
      const y = bhCenterY + r * Math.sin(theta);
      const op = t < 0.1 ? t / 0.1 : t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
      pos.setXYZ(i, x, y, 0);
      size.setX(i, frag.size);
      opacity.setX(i, op);
    }
  }

  pos.needsUpdate = true;
  size.needsUpdate = true;
  opacity.needsUpdate = true;
}

/** The whole scene is skipped under reduced motion — same convention every
 * other rAF-driven effect on this page follows. Deliberately NOT gated on
 * touch/coarse-pointer (which would exclude iPad): the entire point of the
 * move to WebGL was to make this run smoothly on the device that kept
 * dropping frames under the DOM version, not to hide it there instead. */
function usePlutoSceneEnabled(): boolean {
  const enabled = useRef(true);
  if (typeof window !== "undefined") {
    enabled.current = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return enabled.current;
}

export default function PlutoScene({ blackHoleRef }: { blackHoleRef: React.RefObject<HTMLButtonElement> }) {
  const probeRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const enabled = usePlutoSceneEnabled();

  return (
    <>
      {/* Invisible sizing probe — the only reliable way to read
          `calc(68 * var(--body-unit))` (Mars's own size expression; see
          PLANETS in Hub.tsx) back out as a resolved px number, since a
          custom property's computed value doesn't resolve its own calc()
          through getComputedStyle. */}
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "calc(68 * var(--body-unit))",
          height: "calc(68 * var(--body-unit))",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      />
      {enabled && (
        <div className="hb-pluto-canvas" ref={wrapRef} aria-hidden="true">
          {/* antialias off, dpr capped at 1.5: this canvas used to cover the
              full viewport (see .hb-pluto-canvas in hub.css for why it's a
              small bounded box near the hole now instead) — MSAA plus a 2x
              device-pixel-ratio full-screen transparent canvas is real
              fill-rate cost every frame, and iPad's GPU felt all of it. The
              soft circular sprite the particles already use (PARTICLE_SPRITE)
              anti-aliases their own edges regardless of MSAA. */}
          <Canvas orthographic gl={{ alpha: true, antialias: false }} dpr={[1, 1.5]}>
            <ScreenSpaceCamera />
            <PlutoRig blackHoleRef={blackHoleRef} probeRef={probeRef} wrapRef={wrapRef} />
          </Canvas>
        </div>
      )}
    </>
  );
}
