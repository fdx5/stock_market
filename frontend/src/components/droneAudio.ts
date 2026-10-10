/* The drone's sound (3D view 드론 mode): a recorded DJI Mini 2 quadcopter
 * (CC0, public/3d/drone/mini2-20261010-v2/SOURCES.md), quiet under the picture. Its pitch and level follow the motors'
 * load around the original hover RPM, easing up to accelerate or climb; a soft
 * wind rises with the speed. Made on the press of the 드론 button (a browser plays sound only
 * after a gesture). */

const FILES = ["hover", "start"] as const;
const ROOT = "/3d/drone/mini2-20261010-v2";
/** The whole mix's level: a quiet hum, not the room's loudest sound. */
const LEVEL = 0.32;
type Name = (typeof FILES)[number];

let encoded: Promise<Partial<Record<Name, ArrayBuffer>>> | null = null;
function loadBuffers(ctx: AudioContext) {
  // Cache bytes, not a decode promise tied to a possibly closed context. Leaving
  // and re-entering during a slow download must still decode on the new context.
  encoded ??= Promise.all(FILES.map(name =>
    fetch(`${ROOT}/${name}.wav`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(buf => [name, buf] as const).catch(() => [name, null] as const)))
    .then(list => {const bytes=Object.fromEntries(list.filter(([, b]) => b)) as Partial<Record<Name, ArrayBuffer>>;if(!bytes.hover)encoded=null;return bytes;});
  return encoded.then(bytes=>Promise.all(FILES.map(async name=>{try{return[name,bytes[name]?await ctx.decodeAudioData(bytes[name]!.slice(0)):null] as const;}catch{return[name,null] as const;}})))
    .then(list=>Object.fromEntries(list.filter(([, b])=>b)) as Partial<Record<Name,AudioBuffer>>);
}

export class DroneAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private hover: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private hoverAt = 0;
  private generation = 0;
  private starting: Promise<void> | null = null;
  private live = false;
  muted = false;
  /** Quiet while the site's music plays (deskBgmStore): the drone is heard again when it stops. */
  ducked = false;
  private level() { return this.muted || this.ducked ? 0 : LEVEL; }

  /** Call from the button's click (the gesture lets the page play sound). */
  start() {
    if (this.live) return Promise.resolve();
    if (this.starting) return this.starting;
    const generation=++this.generation;
    const pending=this.begin(generation);
    this.starting=pending;
    void pending.finally(()=>{if(this.starting===pending)this.starting=null;});
    return pending;
  }

  private async begin(generation:number) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx ??= new AC();
      const ctx = this.ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const buf = await loadBuffers(ctx);
      if (this.ctx!==ctx || generation!==this.generation || this.live) return;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3;
      this.compressor=comp;
      this.master = ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(comp).connect(ctx.destination);
      const t = ctx.currentTime;
      // The motors spin up, then the loops come in under the end of it.
      let lead = 0;
      if (buf.start) {
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf.start; g.gain.value = 0.6;
        s.connect(g).connect(this.master); s.start(t);
        this.layers.push({src:s,gain:g});
        lead = Math.max(0, buf.start.duration - 0.8);
      }
      const loop = (b: AudioBuffer | undefined, offset: number) => {
        if (!b) return null;
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        src.buffer = b; src.loop = true;
        gain.gain.value = 0;
        src.connect(gain).connect(this.master!);
        src.start(t + lead, offset % b.duration);
        const layer = { src, gain };
        this.layers.push(layer);
        return layer;
      };
      this.hover = loop(buf.hover, 0);
      this.hoverAt=t+lead;
      if(this.hover)this.hover.src.playbackRate.value=1;
      // Wind over the airframe: a little of the recording's own noise is not enough at 200 km/h —
      // filtered noise, swelling with the speed.
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < d.length; i++) { b0 = 0.985 * b0 + 0.12 * (Math.random() * 2 - 1); d[i] = b0; }
      const ns = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), wg = ctx.createGain();
      ns.buffer = noise; ns.loop = true;
      filter.type = "bandpass"; filter.frequency.value = 500; filter.Q.value = 0.6;
      wg.gain.value = 0;
      ns.connect(filter).connect(wg).connect(this.master);
      ns.start(t);
      this.layers.push({ src: ns, gain: wg });
      this.wind = { gain: wg, filter };
      this.live = true;
    } catch (err) {
      console.info("[3D] drone sound unavailable:", err);
    }
  }

  /** load: the motors' throttle 0…1; speed 0…1 of the top speed; bump: a knock (m/s). */
  update(load: number, speed: number, bump = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.live) return;
    const t = ctx.currentTime, k = 0.12;
    load=Number.isFinite(load)?Math.max(0,Math.min(1,load)):.35;
    speed=Number.isFinite(speed)?Math.max(0,Math.min(1,speed)):0;
    if (this.hover) {
      this.hover.src.playbackRate.setTargetAtTime(0.965 + 0.10 * load + 0.02 * speed, t, .18);
      const fade=Math.max(0,Math.min(1,(t-this.hoverAt)/.65));
      this.hover.gain.gain.setTargetAtTime((0.72 + 0.20 * load)*fade, t, k);
    }
    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(0.18 * speed * speed, t, 0.25);
      this.wind.filter.frequency.setTargetAtTime(450 + 850 * speed, t, 0.25);
    }
    if (bump > 3 && this.master) {
      // (a knock against a wall: the motors stutter)
      this.master.gain.setValueAtTime(this.level() * 0.4, t);
      this.master.gain.setTargetAtTime(this.level(), t + 0.05, 0.15);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if(!m&&this.ctx?.state==='suspended')void this.ctx.resume().catch(()=>{});
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  setDucked(d: boolean) {
    if (d === this.ducked) return;
    this.ducked = d;
    // (a short fade: the song comes in over the drone, the drone back under the silence)
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.25);
  }

  /** Off the page or behind another tab: quiet, and the context paused. */
  pause(p: boolean) {
    if (!this.ctx) return;
    if (p) void this.ctx.suspend().catch(()=>{}); else void this.ctx.resume().catch(()=>{});
  }

  stop() {
    ++this.generation;
    this.starting=null;
    const ctx = this.ctx;
    if (!ctx) return;
    this.live = false;
    this.ctx=null;
    const t = ctx.currentTime;
    const master=this.master,comp=this.compressor;
    master?.gain.setTargetAtTime(0, t, 0.12);
    const layers = this.layers;
    this.layers = []; this.hover = null; this.wind = null;this.master=null;this.compressor=null;
    window.setTimeout(() => {
      for (const l of layers) { try { l.src.stop(); } catch { /* already stopped */ } l.src.disconnect(); l.gain.disconnect(); }
      master?.disconnect();comp?.disconnect();
      if(ctx.state!=='closed')void ctx.close().catch(()=>{});
    }, 600);
  }
}
