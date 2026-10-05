import type { DriveSpec } from "../vehicle/physics";

/* The game's sound: one AudioContext for the whole session (made from the start button's click —
 * browsers allow sound only from a gesture), a master level, and the engine: a recorded loop
 * pitched by the revs and loaded by the throttle. A change of vehicle swaps the loop with a short
 * cross-fade; nothing is made again. */

const buffers = new Map<string, Promise<AudioBuffer | null>>();

export class GameAudio {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  private engine: { src: AudioBufferSourceNode; gain: GainNode; tone: BiquadFilterNode; spec: DriveSpec } | null = null;
  private dead = false;
  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
  }
  resume() { if (this.ctx.state === "suspended") void this.ctx.resume(); }
  private load(url: string) {
    let b = buffers.get(url);
    if (!b) {
      b = fetch(url).then(r => r.arrayBuffer()).then(a => this.ctx.decodeAudioData(a)).catch(() => null);
      buffers.set(url, b);
    }
    return b;
  }
  async setVehicle(spec: DriveSpec) {
    const buf = await this.load(spec.sound);
    if (!buf || this.dead) return;
    const old = this.engine, t = this.ctx.currentTime;
    const tone = this.ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2400; tone.connect(this.master);
    const gain = this.ctx.createGain(); gain.gain.value = 0; gain.connect(tone);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    if (spec.loop) { src.loopStart = spec.loop[0]; src.loopEnd = Math.min(buf.duration, spec.loop[1]); }
    src.connect(gain); src.start(0, spec.loop?.[0] ?? 0);
    this.engine = { src, gain, tone, spec };
    if (old) { old.gain.gain.setTargetAtTime(0, t, 0.08); setTimeout(() => { try { old.src.stop(); } catch { /* */ } old.tone.disconnect(); }, 600); }
  }
  /** Each frame: revs (0..1), throttle (0..1), speed (m/s). */
  engineSet(revs: number, throttle: number, speed: number) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime, [p0, p1] = e.spec.pitch, ev = !e.spec.gears;
    e.src.playbackRate.setTargetAtTime(p0 + (p1 - p0) * revs, t, 0.05);
    const level = ev ? Math.min(0.75, 0.04 + revs * 0.9 + throttle * 0.15 * Math.min(1, speed / 3)) : 0.32 + throttle * 0.38 + revs * 0.2;
    e.gain.gain.setTargetAtTime(level, t, 0.06);
    e.tone.frequency.setTargetAtTime(1200 + 3800 * Math.max(revs, throttle * 0.6), t, 0.08);
  }
  engineMute(on: boolean) { const e = this.engine; if (e) e.gain.gain.setTargetAtTime(on ? 0 : 0.3, this.ctx.currentTime, 0.15); }
  /** A low knock on impact. */
  knock(strength: number) {
    if (strength < 0.6) return;
    const ctx = this.ctx, t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = "lowpass"; f.frequency.value = 520; g.gain.value = Math.min(1.4, 0.25 + strength / 6);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
  setVolume(v: number) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  dispose() {
    this.dead = true;
    try { this.engine?.src.stop(); } catch { /* */ }
    void this.ctx.close();
  }
}
