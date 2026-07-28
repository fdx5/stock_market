/* ============================================================================
   Neutron binary, in WebGL.
   ----------------------------------------------------------------------------
   Replaces an earlier DOM/CSS version (two `<span>` discs, positioned via a
   `--nx` custom property and lit with box-shadow + filter: brightness/
   drop-shadow, both rewritten every frame by a plain rAF loop) — see the git
   history for that pass. It was cheaper than the old Pluto DOM version (only
   two elements, not dozens), but still touched the DOM every frame for the
   entire ~15s cycle, and drop-shadow filters are exactly the kind of thing
   Safari/iPadOS tends to composite in software rather than on the GPU. This
   version is the same two-point idea as a tiny WebGL scene instead: two
   additive-blended glow sprites, sized and positioned every frame via
   useFrame, with no DOM writes at all.

   The physics (NEUTRON_ANCHORS/NEUTRON_STAGES, the orbit -> merge -> hold
   state machine) are an unchanged, direct port of the DOM version's own
   useNeutronBinary — only how amp/glow/mscale/phase get drawn each frame
   changed, not how they're computed. The merger flash (.hb-neutron-flash)
   stays a plain DOM/CSS element: it's a full-screen radial gradient driven
   by one class toggle and a CSS `animation`, which was never the expensive
   part, so there's no reason to move it into the scene. */

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** How separated (amp, in the same abstract "units" the old --body-unit
 * design used — see pxPerUnit's own comment for how that becomes real
 * pixels here) and how bright (glow, now a colour multiplier under additive
 * blending rather than a filter: brightness() value — see NeutronRig) the
 * pair is at a given orbital period. Keyed by the exact period values
 * NEUTRON_STAGES uses below. */
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

/* The inspiral: the period shortens 5s -> 4s -> 3s -> 2s -> 1s -> 0.5s ->
 * 0.2s, 20 laps total, closing in as it speeds up, then hands off to the
 * merge/flash/hold sequence below rather than looping back — the pair
 * merges instead of drifting back apart. */
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

/** Same star size the DOM version used — half the Moon's own rendered size
 * (.hb-moon--lunar is `90 * bodyUnit / 3`; this is half that, 15) — but kept
 * here as an abstract "unit" rather than a raw px number, converted via
 * pxPerUnit in NeutronRig, same as amp above. */
const NEUTRON_STAR_SIZE_UNITS = 15;
/** The container's own width, in the same units — see .hb-neutron-canvas in
 * hub.css. pxPerUnit = the container's actual rendered width / this. */
const NEUTRON_CONTAINER_UNITS = 64;

/** Restarts `.hb-neutron-flash`'s burst animation — remove+reflow+add
 * rather than just add, since the class may already be present (holding
 * its post-animation resting state) from a previous merge and a bare
 * add() wouldn't retrigger the CSS animation in that case. */
function fireNeutronFlash(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("is-flashing");
  void el.offsetWidth;
  el.classList.add("is-flashing");
}

/** A soft round glow (radial gradient baked into a small canvas), shared by
 * both stars — see PlutoScene.tsx's PARTICLE_SPRITE for the same technique
 * applied to that scene's debris. */
const GLOW_SPRITE = (() => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(235,244,255,0.95)");
  grad.addColorStop(0.7, "rgba(190,215,255,0.35)");
  grad.addColorStop(1, "rgba(190,215,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
})();

/** Keeps the default orthographic camera in plain screen-pixel coordinates
 * — (0, 0) at the canvas's top-left, Y increasing downward, one world unit
 * per CSS pixel. Local copy of the same small helper PlutoScene.tsx already
 * keeps its own of; see that file's own note on why it isn't shared out. */
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

interface NeutronRigProps {
  containerRef: React.RefObject<HTMLDivElement>;
  flashRef: React.RefObject<HTMLDivElement>;
}

function NeutronRig({ containerRef, flashRef }: NeutronRigProps) {
  const starARef = useRef<THREE.Sprite>(null!);
  const starBRef = useRef<THREE.Sprite>(null!);

  // Mutable, non-reactive playback state — direct port of the DOM version's
  // own useNeutronBinary closure variables into a single ref object instead,
  // since useFrame (not a bespoke rAF loop) is what drives the tick here now.
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
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      state.current.pxPerUnit = rect.width / NEUTRON_CONTAINER_UNITS;
      state.current.centerX = rect.width / 2;
      state.current.centerY = rect.height / 2;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [containerRef]);

  useFrame((_, delta) => {
    const s = state.current;
    // Capped so a background/throttled tab doesn't dump one huge dt on
    // return and skip whole stages (or the entire merge) in one frame.
    const dt = Math.min(delta, 0.1);

    if (s.mode === "orbit") {
      s.stageElapsed += dt;
      let stage = NEUTRON_STAGES[s.stageIndex];
      let stageDuration = stage.period * stage.laps;
      while (s.stageElapsed >= stageDuration) {
        s.stageElapsed -= stageDuration;
        s.stageIndex += 1;
        if (s.stageIndex >= NEUTRON_STAGES.length) {
          // All 20 laps done — hand off to the plunge/merge below instead
          // of wrapping back to stage 0 directly.
          s.mode = "merge";
          s.mergeElapsed = 0;
          s.ampAtMergeStart = s.amp;
          break;
        }
        stage = NEUTRON_STAGES[s.stageIndex];
        stageDuration = stage.period * stage.laps;
      }
      if (s.mode === "orbit") {
        // Eased toward the new stage's separation/glow rather than snapped,
        // so a stage boundary reads as the pair drifting closer rather than
        // teleporting. The angular speed itself still changes instantly at
        // the boundary — that discontinuity is the actual "speeds up"
        // effect that was asked for.
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
      const eased = t * t * (3 - 2 * t); // smoothstep — accelerating infall
      s.amp = s.ampAtMergeStart * (1 - eased);
      s.glow += (NEUTRON_MERGE_GLOW - s.glow) * (1 - Math.exp(-dt / 0.15));
      s.mscale += (NEUTRON_MERGE_SCALE - s.mscale) * (1 - Math.exp(-dt / 0.2));
      // Keep spinning at the fastest rate right through the final plunge.
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
        // Back to stage 0 — amp/glow/mscale ease back out toward the
        // wide/dim/normal-size resting values on their own from here, via
        // the same easing the "orbit" branch above already does.
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
      <sprite ref={starARef}>
        <spriteMaterial map={GLOW_SPRITE} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={starBRef}>
        <spriteMaterial map={GLOW_SPRITE} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
}

/** Skipped under reduced motion — same convention every other rAF/useFrame
 * effect on this page follows; the resting frame is whatever
 * .hb-neutron-canvas's own reduced-motion CSS rule shows instead (a plain
 * gradient, no WebGL mounted at all). */
function useNeutronSceneEnabled(): boolean {
  const enabled = useRef(true);
  if (typeof window !== "undefined") {
    enabled.current = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return enabled.current;
}

export default function NeutronScene({ flashRef }: { flashRef: React.RefObject<HTMLDivElement> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const enabled = useNeutronSceneEnabled();

  return (
    <div className="hb-neutron-canvas" ref={containerRef} aria-hidden="true">
      {enabled && (
        <Canvas orthographic gl={{ alpha: true, antialias: false }} dpr={[1, 1.5]}>
          <ScreenSpaceCamera />
          <NeutronRig containerRef={containerRef} flashRef={flashRef} />
        </Canvas>
      )}
    </div>
  );
}
