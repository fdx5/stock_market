/** Admit builders after drawing, with bounded backoff so scenery cannot starve. */
const waiting: { resolve: () => void; budget: number; since: number; urgent: boolean }[] = [];
let scheduled = false;
let lastForcedAdmission = -Infinity;
let sceneStamp=-Infinity,sceneStartedAt=-Infinity;
/** RAF timestamps name a display tick, not the instant JavaScript began it.
 * Share the first visible view's actual start across views on the same tick. */
export function sceneFrameStarted(stamp:number){
  if(stamp!==sceneStamp){sceneStamp=stamp;sceneStartedAt=performance.now();}
}
let channel: MessageChannel | null = null;
const backgroundQueue: (() => void)[] = [];
function background(f: () => void) {
  // Background-priority postTask itself can starve under continuous animation,
  // before the bounded admission check ever runs. Use the ordinary task queue.
  // The streaming builders can yield thousands of times. Reuse one channel
  // instead of allocating/closing native message ports for every continuation.
  if (!channel) { channel = new MessageChannel(); channel.port1.onmessage = () => backgroundQueue.shift()?.(); }
  backgroundQueue.push(f);
  channel.port2.postMessage(0);
}
function schedule(frameAt?: number) {
  if (scheduled || !waiting.length) return;
  scheduled = true;
  if (document.hidden) {
    background(() => { scheduled = false; waiting.shift()?.resolve(); schedule(); });
    return;
  }
  const admit = (at: number) => background(() => {
    scheduled = false;
    // This timestamp precedes the view drawing; the task observes its cost too.
    const now = performance.now(), first = waiting[0],elapsed=now-at;
    // Prefer spare frame time. Under sustained load, admit just one waiting
    // continuation per 100ms instead of postponing all scenery indefinitely.
    // (urgent work — the roads, paint and traffic of the place the view stands on — goes before
    // the rest: behind the drone's tiles, all FIFO, the first area's lane paint waited ~50 s for its
    // ~0.3 s of work, its cars standing still till then)
    const urgentAt=waiting.findIndex(item=>item.urgent),head=urgentAt>=0?waiting[urgentAt]:first;
    const forced=head&&elapsed>=head.budget&&now-head.since>=100&&now-lastForcedAdmission>=100;
    // A 6ms continuation must not hold up a 9ms continuation while 7ms of the
    // actual frame has been used. Preserve FIFO among eligible work, and still
    // admit an overdue head once per 100ms under continuous pressure.
    const eligibleUrgent=waiting.findIndex(item=>item.urgent&&elapsed<item.budget);
    const index=forced?(urgentAt>=0?urgentAt:0):eligibleUrgent>=0?eligibleUrgent:waiting.findIndex(item=>elapsed<item.budget);
    if(index>=0){
      if(forced)lastForcedAdmission=now;
      waiting.splice(index,1)[0].resolve();
    }
    // A continuation can finish well before this frame's spare time runs out.
    // Recheck after its microtasks have run, instead of charging a whole extra
    // frame for every tiny slice. FIFO and the elapsed admission budget remain.
    if (waiting.some(item=>performance.now()-at<item.budget)) schedule(at);
    else schedule();
  });
  if (frameAt !== undefined) admit(frameAt);
  else requestAnimationFrame(stamp=>admit(sceneStamp===stamp?sceneStartedAt:stamp));
}
/** When work let in by frameSlice gives the frame back: 14 ms after the frame began (its drawing
 * included, the next frame's due at 16.7) — let in late, or with no frame drawing, 2 ms from now. */
export function sliceDeadline(): number {
  const now = performance.now(), into = now - sceneStartedAt;
  return into >= 0 && into < 12 ? sceneStartedAt + 14 : now + 2;
}
export function frameSlice(budgetMs = 9, urgent = false): Promise<void> {
  return new Promise(resolve => { waiting.push({ resolve, budget: budgetMs, since: performance.now(), urgent }); schedule(); });
}

/** Preserve map's order and values while spreading asset construction across frames.
 * Callbacks remain synchronous: each indivisible model completes before yielding. */
export async function mapInSlices<T, U>(items: readonly T[], make: (item: T, index: number) => U, sliceMs = 2): Promise<U[]> {
  const length = items.length, out = new Array<U>(length);
  let started = performance.now();
  for (let i = 0; i < length; i++) {
    if (i in items) out[i] = make(items[i], i);
    if (i + 1 < length && performance.now() - started >= sliceMs) { await frameSlice(); started = performance.now(); }
  }
  return out;
}

/** Filter with the same ordering and identities, without one long junction scan. */
export async function filterInSlices<T>(items: readonly T[], keep: (item: T, index: number) => boolean, sliceMs = 2): Promise<T[]> {
  const length = items.length, out: T[] = [];
  let started = performance.now();
  for (let i = 0; i < length; i++) {
    if (i in items && keep(items[i], i)) out.push(items[i]);
    if (i + 1 < length && performance.now() - started >= sliceMs) { await frameSlice(); started = performance.now(); }
  }
  return out;
}
