// GPU time per render pass from timestamp queries (where the adapter offers them).
// Diagnostics only: measuring GPU work must not change output resolution or quality.
import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';

// Three cascades, static-cache stores, scene/post passes and future split diagnostics.
const PAIRS = 32;

export class GpuTimer {
  constructor({ interval = 7 } = {}) {
    this.enabled = !!GPU.hasTimestamp;
    /** Smoothed milliseconds per pass label, and their sum ('total'). */
    this.ms = {};
    /** Last completed GPU frame; total includes copies and untimed work between passes. */
    this.last = {};
    this.samples = 0;
    // Readbacks are diagnostics, not a dependency of drawing. Avoid resolving and
    // mapping timestamp buffers every frame when a few samples a second suffice.
    // Seven rotates across the 2/3/4/6-frame shadow schedules instead of aliasing.
    this.interval = Math.max(1, Math.floor(interval));
    this.frame = 0;
    this.active = true;
    if (!this.enabled) return;
    this.set = GPU.device.createQuerySet({ type: 'timestamp', count: PAIRS * 2 });
    this.resolve = GPU.device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    // a few staging buffers in flight: a frame never waits on the readback
    this.staging = [0, 1, 2].map(() => ({ buffer: GPU.device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, labels: null }));
    this.labels = [];
  }
  /** Start a frame's measurements. */
  begin() { this.labels = []; this.active = this.frame++ % this.interval === 0; }
  /** timestampWrites for one pass, or undefined (off, or out of slots). */
  pass(label) {
    if (!this.enabled || !this.active || this.labels.length >= PAIRS) return undefined;
    const i = this.labels.push(label) - 1;
    return { querySet: this.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }
  /** Record the resolve (before the frame's submit); read back after it. */
  end(encoder) {
    if (!this.enabled || !this.labels.length) return null;
    const slot = this.staging.find(s => !s.busy);
    if (!slot) return null;
    const n = this.labels.length;
    encoder.resolveQuerySet(this.set, 0, n * 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, slot.buffer, 0, n * 16);
    slot.busy = true;
    slot.labels = this.labels;
    return () => slot.buffer.mapAsync(GPUMapMode.READ, 0, n * 16).then(() => {
      const t = new BigInt64Array(slot.buffer.getMappedRange(0, n * 16));
      const frame = {};
      let total = 0, first = null, last = null;
      slot.labels.forEach((label, i) => {
        const ms = Math.max(0, Number(t[i * 2 + 1] - t[i * 2]) / 1e6);
        if (ms < 1000) {
          frame[label] = (frame[label] ?? 0) + ms; total += ms;
          const a = t[i * 2], b = t[i * 2 + 1];
          if (first === null || a < first) first = a;
          if (last === null || b > last) last = b;
        }
      });
      slot.buffer.unmap();
      slot.busy = false;
      // Summing timed render passes omitted the full-resolution water copies, second AO
      // blur and bloom upsample passes. The first-to-last span includes those GPU costs.
      frame.passes = total;
      frame.total = first === null ? 0 : Math.max(total, Number(last - first) / 1e6);
      frame.other = Math.max(0, frame.total - total);
      this.last = frame;
      const k = this.samples++ < 5 ? 0.5 : 0.1;
      // A cascade not drawn this frame costs zero; retaining its last nonzero reading
      // made pass averages disagree with the actual frame (and hid cache benefits).
      for (const key in this.ms) if (!(key in frame)) frame[key] = 0;
      for (const key in frame) this.ms[key] = (this.ms[key] ?? frame[key]) * (1 - k) + frame[key] * k;
    }).catch(() => { slot.busy = false; });
  }
  dispose() {
    if (!this.enabled) return;
    this.set.destroy(); this.resolve.destroy();
    this.staging.forEach(s => s.buffer.destroy());
  }
}
