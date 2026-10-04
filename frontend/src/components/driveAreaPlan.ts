/** Keep the next centre inside the overlapping 600 m scenes, while allowing
 * enough runway for network requests and background construction at speed. */
export function driveAreaPlan(car: { x: number; y: number; hx: number; hy: number; speed: number }) {
  const speed = Math.abs(car.speed), direction = car.speed < -1 ? -1 : 1;
  const hx = car.hx * direction, hy = car.hy * direction;
  const lead = Math.min(600, Math.max(360, 260 + speed * 10));
  const look = Math.min(800, 220 + speed * 18);
  return { hx, hy, lead, look, due: Math.hypot(car.x + hx * look, car.y + hy * look) > 420 };
}

export function driveSurroundings(x: number, y: number) {
  const ax = Math.round(x / 300) * 300, ay = Math.round(y / 300) * 300;
  return [[ax + 480, ay], [ax - 480, ay], [ax, ay + 480], [ax, ay - 480]] as [number, number][];
}

/** Two network preparations at a time; queued travel directions can be promoted.
 * Completed areas survive turns and return trips without another download. */
export class DriveAreaCache<T> {
  private entries = new Map<string, { promise: Promise<T | null>; ready: boolean; cancel: () => void; task: () => Promise<T | null> }>();
  private retryAt = new Map<string, number>();
  private queue: string[] = [];
  private active = 0;
  request(key: string, load: () => Promise<T | null>, priority = false): Promise<T | null> {
    if ((this.retryAt.get(key) ?? 0) > Date.now()) return Promise.resolve(null);
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key); this.entries.set(key, old);
      if (priority && this.queue.includes(key)) {
        this.queue = [key, ...this.queue.filter(k => k !== key)];
      }
      return old.promise;
    }
    let resolve!: (value: T | null) => void;
    const promise = new Promise<T | null>(done => { resolve = done; });
    const entry = { promise, ready: false, cancel: () => resolve(null), task: async () => {
      let value: T | null = null;
      try { value = await load(); } catch { /* allow a subsequent retry */ }
      entry.ready = true;
      if (value === null) {
        this.entries.delete(key); this.retryAt.set(key, Date.now() + 10000);
        while (this.retryAt.size > 32) this.retryAt.delete(this.retryAt.keys().next().value!);
      } else this.retryAt.delete(key);
      resolve(value);
      return value;
    } };
    this.entries.set(key, entry);
    if (priority) this.queue.unshift(key); else this.queue.push(key);
    while (this.queue.length > 8) {
      const skipped = this.queue.pop()!;
      this.entries.get(skipped)?.cancel(); this.entries.delete(skipped);
    }
    this.pump();
    return promise;
  }
  private pump() {
    while (this.active < 2 && this.queue.length) {
      const entry = this.entries.get(this.queue.shift()!);
      if (!entry) continue;
      this.active++;
      void entry.task().finally(() => {
        this.active--;
        for (const [key, item] of this.entries) {
          if (this.entries.size <= 16) break;
          if (item.ready) this.entries.delete(key);
        }
        this.pump();
      });
    }
  }
}
