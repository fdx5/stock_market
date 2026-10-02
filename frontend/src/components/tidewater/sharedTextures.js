// Only immutable, identified source pixels are shared. There is no idle cache:
// the last owning view releases the GPU allocation immediately.
export class SharedTextures {
  constructor() { this.entries = new Map(); this.byTexture = new Map(); }
  peek(key) { return this.entries.get(key)?.texture; }
  acquire(key, owner, create) {
    let entry = this.entries.get(key);
    if (!entry && create) {
      entry = { key, texture: create(), owners: new Set() };
      this.entries.set(key, entry); this.byTexture.set(entry.texture, entry);
    }
    if (!entry) return null;
    entry.owners.add(owner);
    return entry.texture;
  }
  has(texture) { return this.byTexture.has(texture); }
  release(texture, owner) {
    const entry = this.byTexture.get(texture);
    if (!entry) return;
    entry.owners.delete(owner);
    if (entry.owners.size) return;
    this.entries.delete(entry.key); this.byTexture.delete(texture); texture.destroy();
  }
  releaseOwner(owner) {
    for (const texture of this.byTexture.keys()) this.release(texture, owner);
  }
}
const devices = new WeakMap();
export function sharedTexturesFor(device) {
  let pool = devices.get(device);
  if (!pool) { pool = new SharedTextures(); devices.set(device, pool); }
  return pool;
}
