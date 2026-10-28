/* The walk's sounds. Water and the cat are recordings (CC0, public/3d/walk/sfx — see SOURCES.md):
 * a flush, a washbasin tap and its drain, a kitchen sink filling, a kitten's meows, a purr. They are
 * fetched while the flat loads; until they arrive (or if they can't) the same sounds are made here
 * from noise and tones, as are the rest: a switch's click, a door, curtains, a beep, footsteps that
 * sound like the floor. Sound starts on the first key or touch (browsers allow it only then). */

import { BicycleAudio, type BicycleAudioState } from "./BicycleAudio";

const SFX = "/3d/walk/sfx/";
const MEOWS = ["meow1", "meow2", "meow3", "meow4", "meow5", "meow6", "meow7"];
const BARKS = ["bark1", "bark2", "bark3", "bark4", "bark5", "bark6"];
const RECORDINGS = ["flush", "basin_loop", "basin_end", "sink_loop", "purr_loop", "pant_loop", ...MEOWS, ...BARKS];
/** each loop file carries this much of its own loop before and after it (see SOURCES.md) */
const LOOP_PAD = 0.15;
/** what a running sound is: a tap (which one), a shower, or a machine's hum */
export type WaterKind = "basin" | "sink" | "tub" | "shower" | "air";
/** each kind of running water: its recording, pitch, filter and loudness */
const RUN: Record<Exclude<WaterKind, "air">, { rec: string; rate: number; filter?: [BiquadFilterType, number]; gain: number; drain?: boolean }> = {
  basin: { rec: "basin_loop", rate: 1, gain: 0.55, drain: true },
  sink: { rec: "sink_loop", rate: 1, gain: 0.5, drain: true },
  tub: { rec: "sink_loop", rate: 0.8, filter: ["lowpass", 2600], gain: 0.6 },
  shower: { rec: "basin_loop", rate: 1.2, filter: ["highpass", 500], gain: 0.5 },
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private water: { g: GainNode; f: BiquadFilterNode } | null = null;
  private hum: GainNode | null = null;
  private rec = new Map<string, AudioBuffer>();
  private recLoading: Promise<void> | null = null;
  private runs = new Map<WaterKind, { g: GainNode; peak: number; level: number }>();
  private bicycleNode: BicycleAudio | null = null;
  muted = false;

  /** Fetch and decode the recordings (decoded off the page's audio context, so before any gesture). */
  loadRecordings(): Promise<void> {
    if (this.recLoading) return this.recLoading;
    let dec: BaseAudioContext;
    try { dec = new OfflineAudioContext(1, 1, 48000); } catch { return (this.recLoading = Promise.resolve()); }
    this.recLoading = Promise.all(RECORDINGS.map(async n => {
      try {
        const r = await fetch(`${SFX}${n}.mp3`);
        if (r.ok) this.rec.set(n, await dec.decodeAudioData(await r.arrayBuffer()));
      } catch { /* the synthesized sound stays */ }
    })).then(() => undefined);
    return this.recLoading;
  }
  /** a recording once: its gain, pitch, from where (s) */
  private shot(name: string, gain: number, rate = 1, offset = 0): boolean {
    const c = this.ctx, b = this.rec.get(name); if (!c || !b || !this.master) return false;
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(this.master); src.start(c.currentTime, Math.min(offset, b.duration - 0.05));
    return true;
  }
  /** a recording looping (from inside its padding: seamless whatever the decoder's offset), silent at first */
  private looped(name: string, rate = 1, filter?: [BiquadFilterType, number]): GainNode | null {
    const c = this.ctx, b = this.rec.get(name); if (!c || !b || !this.master) return null;
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    src.loopStart = LOOP_PAD; src.loopEnd = b.duration - LOOP_PAD; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = 0;
    let out: AudioNode = src;
    if (filter) { const f = c.createBiquadFilter(); f.type = filter[0]; f.frequency.value = filter[1]; src.connect(f); out = f; }
    out.connect(g); g.connect(this.master);
    src.start(c.currentTime, LOOP_PAD + Math.random() * (b.duration - 2 * LOOP_PAD));
    return g;
  }

  resume() {
    if (!this.ctx) {
      try {
        const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new C();
      } catch { return; }
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
      const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
      // a running-water bed: looping noise through a band filter, silent until a tap opens
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.6;
      const f2 = c.createBiquadFilter(); f2.type = "highshelf"; f2.frequency.value = 3000; f2.gain.value = -6;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(f2); f2.connect(g); g.connect(this.master); src.start();
      this.water = { g, f };
      // the faint room tone of a flat (a fridge's hum)
      const o = c.createOscillator(); o.frequency.value = 58; const hg = c.createGain(); hg.gain.value = 0.006; o.connect(hg); hg.connect(this.master); o.start();
      this.hum = hg;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  get audioGraph() { return this.ctx && this.master && this.noise ? { ctx: this.ctx, output: this.master, noise: this.noise } : null; }

  bicycle(state: BicycleAudioState) {
    if (!this.ctx || !this.master || !this.noise) return;
    if (!this.bicycleNode && state.speed > 0.06) this.bicycleNode = new BicycleAudio(this.ctx, this.master, this.noise);
    this.bicycleNode?.update(state);
  }
  stopBicycle() { this.bicycleNode?.stop(); }
  bicycleLatch() { this.burst(0.075, 1550, 1.2, 0.18); this.burst(0.09, 320, 0.8, 0.09, "lowpass"); }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", sweepTo?: number, attack = 0.002) {
    const c = this.ctx; if (!c || !this.noise || !this.master) return;
    const t = c.currentTime, src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
    const c = this.ctx; if (!c || !this.master) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  play(kind: "click" | "water" | "flush" | "door" | "curtain" | "beep" | "doorlock" | "thud" | "fridge" | "meow" | "bark") {
    switch (kind) {
      case "click": this.burst(0.03, 3200, 2, 0.5, "bandpass"); this.burst(0.05, 900, 1.5, 0.25); break;
      case "beep": this.tone(1318, 0.09, 0.08); break;
      case "doorlock": [0, 90, 180].forEach((ms, i) => setTimeout(() => this.tone([1046, 1318, 1568][i], 0.12, 0.07), ms)); break;
      case "door": this.burst(0.25, 180, 0.8, 0.5, "lowpass"); this.burst(0.06, 1500, 3, 0.15); break;
      case "thud": this.burst(0.18, 140, 0.8, 0.45, "lowpass"); break;
      case "curtain": this.burst(0.9, 2600, 0.7, 0.12, "bandpass", 1800, 0.25); break;
      case "fridge": this.burst(0.35, 400, 0.6, 0.25, "lowpass"); this.tone(220, 0.25, 0.02); break;
      case "meow":
        if (!this.shot(MEOWS[Math.floor(Math.random() * MEOWS.length)], 0.5, 0.95 + Math.random() * 0.12)) this.meow();
        break;
      case "bark":
        // (a spitz's bark, pitched down for a Shiba; no stand-in if the recordings are missing)
        this.shot(BARKS[Math.floor(Math.random() * BARKS.length)], 0.45, 0.84 + Math.random() * 0.08);
        break;
      case "flush":
        if (this.shot("flush", 0.9)) break;
        this.burst(0.15, 900, 1, 0.4);
        this.burst(3.6, 700, 0.5, 0.55, "bandpass", 300, 0.25);
        setTimeout(() => this.burst(3.0, 2400, 0.8, 0.12, "bandpass", 1200, 0.6), 1800);
        break;
      default: break;
    }
  }
  /** a cat's "mrrow": a voiced glide through two vowel-like formants */
  meow() {
    const c = this.ctx; if (!c || !this.master) return;
    const t = c.currentTime, d = 0.55 + Math.random() * 0.25, o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth";
    const f0 = 480 + Math.random() * 120;
    o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + d * 0.35); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + d);
    const f1 = c.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 6; f1.frequency.setValueAtTime(700, t); f1.frequency.linearRampToValueAtTime(1300, t + d * 0.4); f1.frequency.linearRampToValueAtTime(800, t + d);
    const f2 = c.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 8; f2.frequency.setValueAtTime(2400, t); f2.frequency.linearRampToValueAtTime(3000, t + d * 0.4);
    const mix = c.createGain(); mix.gain.value = 1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.06); g.gain.setValueAtTime(0.09, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f1); o.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + d + 0.05);
  }
  private purrNode: { g: GainNode; lfo: OscillatorNode } | null = null;
  /** a purr while it lasts: 0..1 */
  private pantRec: GainNode | null = null;
  /** a dog's happy panting while it lasts: 0..1 */
  pant(level: number) {
    const c = this.ctx; if (!c) return;
    if (!this.pantRec && level > 0) this.pantRec = this.looped("pant_loop");
    this.pantRec?.gain.setTargetAtTime(level * 0.5, c.currentTime, 0.2);
  }
  private purrRec: GainNode | null = null;
  purr(level: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (this.purrRec || (level > 0 && (this.purrRec = this.looped("purr_loop")))) {
      this.purrRec.gain.setTargetAtTime(level * 0.7, c.currentTime, 0.2);
      return;
    }
    if (!this.purrNode) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220;
      const am = c.createGain(); am.gain.value = 0;
      const lfo = c.createOscillator(); lfo.frequency.value = 26; const depth = c.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth); depth.connect(am.gain);
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(am); am.connect(g); g.connect(this.master); src.start(); lfo.start();
      this.purrNode = { g, lfo };
    }
    this.purrNode.g.gain.setTargetAtTime(level * 0.9, c.currentTime, 0.15);
  }
  /** a robot vacuum's whirr: 0..1 */
  private whirrNode: GainNode | null = null;
  whirr(level: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (!this.whirrNode) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2600; f.Q.value = 1.4;
      const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = 180; const og = c.createGain(); og.gain.value = 0.15;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); o.connect(og); og.connect(g); g.connect(this.master); src.start(); o.start();
      this.whirrNode = g;
    }
    this.whirrNode.gain.setTargetAtTime(level * 0.12, c.currentTime, 0.2);
  }
  /** a footstep on wood, tile or stone */
  step(floor: "wood" | "tile" | "stone", run: boolean) {
    const k = run ? 1.4 : 1;
    if (floor === "wood") { this.burst(0.07, 240, 1.2, 0.22 * k, "lowpass"); this.burst(0.03, 2200, 2, 0.03 * k); }
    else if (floor === "tile") { this.burst(0.05, 1800, 1.4, 0.07 * k); this.burst(0.06, 300, 1, 0.12 * k, "lowpass"); }
    else { this.burst(0.06, 900, 1, 0.12 * k); }
  }
  /** What is running this frame, by kind: each 0..1, already softened by distance. Taps and
   * showers play their recordings (a basin or sink drains with a gurgle when it is shut); anything
   * without one — a machine's hum, or water before the recordings arrive — the noise bed. */
  running(levels: Partial<Record<WaterKind, number>>) {
    const c = this.ctx; if (!c || !this.water) return;
    let bed = levels.air ?? 0;
    for (const k of Object.keys(RUN) as (keyof typeof RUN)[]) {
      const lv = Math.min(1, levels[k] ?? 0), spec = RUN[k];
      let run = this.runs.get(k);
      if (!run && lv > 0) { const g = this.looped(spec.rec, spec.rate, spec.filter); if (g) this.runs.set(k, run = { g, peak: 0, level: 0 }); }
      if (!run) { bed += lv; continue; }
      run.g.gain.setTargetAtTime(lv * spec.gain, c.currentTime, 0.08);
      if (lv > run.level) run.peak = Math.max(run.peak, lv);
      // (shut: the last of the water down the plughole)
      if (spec.drain && run.level > 0.5 * run.peak && lv < 0.35 * run.peak && run.peak > 0.05) { this.shot("basin_end", run.peak * 0.6, k === "sink" ? 0.9 : 1, 0.55); run.peak = 0; }
      if (lv < 0.01) run.peak = 0;
      run.level = lv;
    }
    this.water.g.gain.setTargetAtTime(Math.min(0.9, bed) * 0.5, c.currentTime, 0.08);
  }
  dispose() { this.bicycleNode?.dispose(); this.bicycleNode = null; try { void this.ctx?.close(); } catch { /* */ } this.ctx = null; this.hum = null; this.runs.clear(); this.purrRec = null; this.pantRec = null; this.purrNode = null; this.whirrNode = null; }
}
