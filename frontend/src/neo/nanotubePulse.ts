const random = (seed: number) => {
  let value = Math.imul(seed ^ 0x6d2b79f5, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

/** Independent signal trains, flowing from the bottom UV=1 to the top UV=0. */
export class NanotubePulses {
  private trains: { cycle: number; start: number; duration: number; width: number }[];
  readonly data: Float32Array;

  constructor(count: number) {
    const launchOrder = Array.from({ length: count }, (_, id) => id).sort((a,b) => random(a * 73 + 5) - random(b * 73 + 5));
    this.trains = Array.from({ length: count }, (_, id) => ({
      cycle: 0, start: launchOrder.indexOf(id) * .62 + random(id * 29 + 23) * .35, duration: 3.4 + random(id * 71 + 13) * 3.6,
      width: .026 + random(id * 37 + 31) * .027,
    }));
    this.data = new Float32Array(count * 4);
  }

  sample(time: number) {
    this.trains.forEach((train, id) => {
      while (time > train.start + train.duration) {
        const seed = id * 197 + ++train.cycle * 61;
        train.start += train.duration + .8 + random(seed + 7) * 3.5;
        train.duration = 3.4 + random(seed + 13) * 3.6;
        train.width = .026 + random(seed + 31) * .027;
      }
      const progress = (time - train.start) / train.duration;
      const active = progress >= 0 && progress <= 1;
      const weight = active ? Math.pow(Math.sin(Math.PI * progress), .38) : 0;
      this.data.set([active ? 1.06 - progress * 1.12 : -10, weight, train.width, train.cycle], id * 4);
    });
    return this.data;
  }
}
