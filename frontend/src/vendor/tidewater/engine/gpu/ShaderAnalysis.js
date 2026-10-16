import { BoundedCache } from './BoundedCache.js';

let worker, id = 0, idle;
const pending = new Map();
// Streaming buildings share shader text while retaining their own GPU bindings.
// Coalesce concurrent parsing and retain only bounded, pure finished WGSL text.
const inFlight = new Map();
const finished = new BoundedCache(64, 2 * 1024 * 1024);
function retireWhenIdle(current) {
  if (!pending.size) idle = setTimeout(() => {
    if (worker === current && !pending.size) { current.terminate(); worker = null; }
  }, 5000);
}
export function shaderAnalysis(op, code, defines) {
  const key = JSON.stringify([op, defines]) + '\u0000' + code;
  const cached = finished.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inFlight.get(key);
  if (running) return running;
  clearTimeout(idle);
  if (!worker) {
    const current = worker = new Worker(new URL('./ShaderTextWorker.js', import.meta.url), { type: 'module' });
    current.onmessage = ({ data }) => {
      if (worker !== current) return;
      const job = pending.get(data.id); if (!job) return;
      pending.delete(data.id);
      if (data.error) job.reject(Error(data.error)); else job.resolve(data.value);
      retireWhenIdle(current);
    };
    current.onerror = event => {
      if (worker !== current) return;
      clearTimeout(idle);
      for (const job of pending.values()) job.reject(Error(event.message || 'Shader analysis worker could not load or execute'));
      pending.clear(); current.terminate(); worker = null;
    };
  }
  const result = new Promise((resolve, reject) => {
    const token = ++id; pending.set(token, { resolve, reject });
    try { worker.postMessage({ id: token, op, code, defines }); }
    catch (error) { pending.delete(token); retireWhenIdle(worker); reject(error); }
  });
  inFlight.set(key, result);
  // Failed jobs are retryable. Do not cache device resources or mutable bindings.
  result.then(value => {
    if (inFlight.get(key) === result) inFlight.delete(key);
    if (op === 'finish' && typeof value === 'string') finished.set(key, value);
  }, () => { if (inFlight.get(key) === result) inFlight.delete(key); });
  return result;
}
