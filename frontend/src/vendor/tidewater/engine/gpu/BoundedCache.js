// Cache budgets concern CPU references and shader text only. Eviction never alters
// a live render resource or visual quality; an evicted entry is recreated on demand.
export class BoundedCache extends Map {
  constructor(maxEntries = 128, maxBytes = 4 * 1024 * 1024) {
    super(); this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.bytes = 0; this.costs = new Map();
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key)) { super.delete(key); super.set(key, value); }
    return value;
  }
  set(key, value) {
    this.delete(key);
    const cost = (typeof key === 'string' ? key.length * 2 : 32) + (typeof value === 'string' ? value.length * 2 : 256);
    if (cost > this.maxBytes) return this;
    super.set(key, value); this.costs.set(key, cost); this.bytes += cost;
    while (this.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.keys().next().value);
    return this;
  }
  delete(key) { this.bytes -= this.costs.get(key) ?? 0; this.costs.delete(key); return super.delete(key); }
  clear() { super.clear(); this.costs.clear(); this.bytes = 0; }
}
