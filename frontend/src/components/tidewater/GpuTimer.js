// GPU time per render pass from timestamp queries (where the adapter offers them).
// The complex view uses the total to size its resolution to the GPU it runs on: frame
// time alone cannot tell a slow GPU from a busy main thread.
import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';

const PAIRS = 12;

export class GpuTimer {
  constructor() {
    this.enabled = !!GPU.hasTimestamp;
    /** Smoothed milliseconds per pass label, and their sum ('total'). */
    this.ms = {};
    this.samples = 0;
    if (!this.enabled) return;
    this.set = GPU.device.createQuerySet({ type: 'timestamp', count: PAIRS * 2 });
    this.resolve = GPU.device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    // a few staging buffers in flight: a frame never waits on the readback
    this.staging = [0, 1, 2].map(() => ({ buffer: GPU.device.createBuffer({ size: PAIRS * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, labels: null }));
    this.labels = [];
  }
  /** Start a frame's measurements. */
  begin() { this.labels = []; }
  /** timestampWrites for one pass, or undefined (off, or out of slots). */
  pass(label) {
    if (!this.enabled || this.labels.length >= PAIRS) return undefined;
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
      let total = 0;
      slot.labels.forEach((label, i) => {
        const ms = Math.max(0, Number(t[i * 2 + 1] - t[i * 2]) / 1e6);
        if (ms < 1000) { frame[label] = (frame[label] ?? 0) + ms; total += ms; }
      });
      slot.buffer.unmap();
      slot.busy = false;
      frame.total = total;
      const k = this.samples++ < 5 ? 0.5 : 0.1;
      for (const key in frame) this.ms[key] = (this.ms[key] ?? frame[key]) * (1 - k) + frame[key] * k;
    }).catch(() => { slot.busy = false; });
  }
  dispose() {
    if (!this.enabled) return;
    this.set.destroy(); this.resolve.destroy();
    this.staging.forEach(s => s.buffer.destroy());
  }
}
