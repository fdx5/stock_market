/** Ownership of one complex. Disposing a GPU resource must also remove the CPU
 * owner reference: Three's dispose() deliberately leaves its typed arrays intact. */
export class SceneResources {
  private owned = new Set<{ dispose(): void }>();
  private closed = false;

  push(...items: { dispose(): void }[]) { items.forEach(item => this.keep(item)); }

  keep<T extends { dispose(): void }>(item: T): T {
    if (this.closed) { item.dispose(); return item; }
    if (this.owned.has(item)) return item;
    this.owned.add(item);
    const events = item as T & { addEventListener?: (name: string, f: () => void) => void; removeEventListener?: (name: string, f: () => void) => void };
    if (events.addEventListener) {
      const released = () => { this.owned.delete(item); events.removeEventListener?.("dispose", released); };
      events.addEventListener("dispose", released);
    }
    return item;
  }

  forEach(dispose: (item: { dispose(): void }) => void) {
    this.closed = true;
    for (const item of this.owned) dispose(item);
    this.owned.clear();
  }
}
