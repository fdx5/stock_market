/** Admit builders after drawing, with bounded backoff so scenery cannot starve. */
const waiting: { resolve: () => void; budget: number; since: number }[] = [];
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
    const forced=first&&elapsed>=first.budget&&now-first.since>=100&&now-lastForcedAdmission>=100;
    // A 6ms continuation must not hold up a 9ms continuation while 7ms of the
    // actual frame has been used. Preserve FIFO among eligible work, and still
    // admit an overdue head once per 100ms under continuous pressure.
    const index=forced?0:waiting.findIndex(item=>elapsed<item.budget);
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
export function frameSlice(budgetMs = 9): Promise<void> {
  return new Promise(resolve => { waiting.push({ resolve, budget: budgetMs, since: performance.now() }); schedule(); });
}
