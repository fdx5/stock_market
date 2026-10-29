import * as THREE from "three";
import { BloomEffect, BrightnessContrastEffect, EffectComposer, EffectPass, HueSaturationEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
// @ts-expect-error — n8ao ships no type declarations
import { N8AOPostPass } from "n8ao";

/* The walk's picture after the scene is drawn (pmndrs/postprocessing, N8AO):
 *   ambient occlusion — corners, kerbs, the feet of walls and furniture darkened as light reaches them
 *     less (the flat, floating look of an unlit scene goes);
 *   bloom — lamps, signs and lit windows glow (a little by day, more at night);
 *   ACES tone mapping (as the renderer's own was), a faint vignette, SMAA edges.
 * Full resolution throughout (frontend/AGENTS.md: no resolution lowered). It watches its frame time:
 * a device that cannot keep 50 fps with it loses the occlusion first, then the rest, and the plain
 * render returns — the frame rate before the picture. */
export class PostFX {
  private composer: EffectComposer;
  private ao: { configuration: Record<string, unknown>; setQualityMode(m: string): void; enabled: boolean; setSize(w: number, h: number): void };
  private effects: EffectPass;
  /** false: no stepping down (for measuring) */
  auto = true;
  private on = true; private slowFor = 0; private level = 1; private recheckAt = 0;
  /** the occlusion costs a second draw of the scene (39 against 56 fps measured): only on ?ao=1 */
  private top = new URLSearchParams(location.search).get("ao") === "1" ? 2 : 1;
  private tone: THREE.ToneMapping; private exposure: number;
  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, night: number, aoRadius = 2.2) {
    this.tone = renderer.toneMapping; this.exposure = renderer.toneMappingExposure;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    const ao = new N8AOPostPass(scene, camera, size.x, size.y);
    // (the occlusion's own buffer at half size, upsampled depth-aware: the picture stays full size)
    ao.setQualityMode("Low");
    Object.assign(ao.configuration, { aoRadius, distanceFalloff: 1.0, intensity: 2.2, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color(0, 0, 0) });
    this.ao = ao; this.composer.addPass(ao);
    const bloom = new BloomEffect({ intensity: 0.25 + 0.9 * night, luminanceThreshold: 0.9 - 0.25 * night, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    // (a grade after the tone: a touch more contrast and colour — the flat, grey cast of the plain render)
    this.effects = new EffectPass(camera, bloom, tone, new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 }), new HueSaturationEffect({ saturation: 0.12 }), new VignetteEffect({ offset: 0.35, darkness: 0.35 }));
    this.composer.addPass(this.effects);
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    // (the composer tone-maps at its end: the renderer's own is turned off while it draws)
    renderer.toneMapping = THREE.NoToneMapping;
    this.level = this.top; this.apply();
  }
  setSize(w: number, h: number) { this.composer.setSize(w, h, false); }
  /** the frame: through the effects, or plain when they were given up; dt in seconds */
  render(dt: number, scene: THREE.Scene, camera: THREE.Camera) {
    const now = performance.now();
    // (frames slower than 20 ms for two seconds running: a step down; tried again after a minute)
    if (dt > 0.02) this.slowFor += dt; else this.slowFor = Math.max(0, this.slowFor - dt * 0.5);
    if (!this.auto) { /* (fixed: a measurement) */ }
    else if (this.slowFor > 2 && this.level > 0) { this.level--; this.slowFor = 0; this.apply(); this.recheckAt = now + 60000; }
    else if (this.level < this.top && now > this.recheckAt && this.slowFor === 0) { this.level++; this.apply(); this.recheckAt = now + 60000; }
    // (the building interiors share the renderer and set their own tone and exposure: put back)
    this.renderer.toneMappingExposure = this.exposure;
    if (this.on) { this.renderer.toneMapping = THREE.NoToneMapping; this.composer.render(dt); }
    else { this.renderer.toneMapping = this.tone; this.renderer.render(scene, camera); }
  }
  private apply() {
    this.ao.enabled = this.level >= 2;
    this.on = this.level >= 1;
    this.renderer.toneMapping = this.on ? THREE.NoToneMapping : this.tone; this.renderer.toneMappingExposure = this.exposure;
  }
  setLevel(l: number) { this.level = Math.max(0, Math.min(2, l)); this.apply(); }
  get state() { return this.level === 2 ? "full" : this.level === 1 ? "no-ao" : "off"; }
  dispose() { this.composer.dispose(); this.renderer.toneMapping = this.tone; }
}
