/** A bicycle's mechanical sounds, synthesized locally. No downloads or frame-by-frame
 * node creation: four filtered loops and one very quiet brake resonance are reused. */
export interface BicycleAudioState { speed: number; pedal: number; brake: number }
const clamp = (v: number, max = 1) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));

export class BicycleAudio {
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private channels: { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode }[] = [];
  private resonance: OscillatorNode;
  private resonanceGain: GainNode;
  private last = -Infinity;
  private stopped = true;

  constructor(private ctx: BaseAudioContext, output: AudioNode, noise: AudioBuffer) {
    const bus = ctx.createGain(); bus.gain.value = 1.6; bus.connect(output); this.nodes.push(bus); output = bus;
    const loop = (type: BiquadFilterType, frequency: number, buffer = noise) => {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = 0.65;
      const gain = ctx.createGain(); gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(output); source.start();
      this.sources.push(source); this.nodes.push(source, filter, gain);
      const channel = { source, filter, gain }; this.channels.push(channel); return channel;
    };
    loop("bandpass", 620); // tyre contact on pavement
    loop("lowpass", 900);  // air rushing around the rider
    // Chain links have a short, regular, noisy metallic contact, without an engine tone.
    const clicks = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate), data = clicks.getChannelData(0);
    const sourceNoise = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const phase = (i / ctx.sampleRate * 24) % 1;
      data[i] = sourceNoise[i % sourceNoise.length] * Math.exp(-phase * 42);
    }
    loop("bandpass", 2400, clicks); // chain under pedal load
    loop("highpass", 1800, clicks); // freewheel ratchet when coasting
    loop("bandpass", 1900); // brake-pad friction
    this.resonance = ctx.createOscillator(); this.resonance.type = "sine"; this.resonance.frequency.value = 780;
    this.resonanceGain = ctx.createGain(); this.resonanceGain.gain.value = 0;
    this.resonance.connect(this.resonanceGain); this.resonanceGain.connect(output); this.resonance.start();
    this.sources.push(this.resonance); this.nodes.push(this.resonance, this.resonanceGain);
  }

  private target(param: AudioParam, value: number, time: number, fade = 0.055) {
    param.cancelScheduledValues(time); param.setTargetAtTime(value, time, fade);
  }

  update(state: BicycleAudioState) {
    const t = this.ctx.currentTime, speed = clamp(state.speed, 60 / 3.6), v = speed / (60 / 3.6);
    if (speed < 0.06) { this.stop(); return; }
    if (!this.stopped && t - this.last < 0.04) return;
    this.last = t; this.stopped = false;
    const pedal = clamp(state.pedal), brake = clamp(state.brake), rolling = Math.min(1, speed / 1.4);
    const [tyres, wind, chain, freewheel, pads] = this.channels;
    this.target(tyres.gain.gain, rolling * (0.045 + v * 0.09), t);
    this.target(tyres.filter.frequency, 420 + v * 1550, t);
    this.target(wind.gain.gain, Math.pow(v, 1.8) * 0.15, t);
    this.target(wind.filter.frequency, 550 + v * 1350, t);
    this.target(chain.gain.gain, rolling * pedal * (1 - brake) * (0.13 + 0.11 * v), t);
    this.target(chain.source.playbackRate, 0.7 + Math.min(speed / 4, 2.8), t);
    this.target(freewheel.gain.gain, rolling * (1 - pedal) * (1 - brake * 0.75) * (0.13 + 0.1 * v), t);
    this.target(freewheel.source.playbackRate, 0.55 + speed * 0.18, t);
    this.target(pads.gain.gain, brake * rolling * (0.09 + v * 0.14), t, 0.025);
    this.target(pads.filter.frequency, 850 + v * 2200, t);
    this.target(this.resonance.frequency, 430 + Math.sqrt(v) * 570, t);
    this.target(this.resonanceGain.gain, brake * rolling * (0.008 + v * 0.012), t, 0.025);
  }

  /** Immediate state changes fade all loops, including when no further frames arrive. */
  stop() {
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    for (const c of this.channels) this.target(c.gain.gain, 0, t, 0.025);
    this.target(this.resonanceGain.gain, 0, t, 0.025); this.stopped = true; this.last = -Infinity;
  }

  dispose() {
    for (const source of this.sources) { try { source.stop(); } catch { /* already stopped */ } }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = this.nodes.length = this.channels.length = 0;
  }
}
