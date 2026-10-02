let worker, id = 0, idle;
const pending = new Map();
export function shaderAnalysis(op, code, defines) {
  clearTimeout(idle);
  if (!worker) {
    const current = worker = new Worker(new URL('./ShaderTextWorker.js', import.meta.url), { type: 'module' });
    current.onmessage = ({ data }) => {
      if (worker !== current) return;
      const job = pending.get(data.id); if (!job) return;
      pending.delete(data.id);
      if (data.error) job.reject(Error(data.error)); else job.resolve(data.value);
      if (!pending.size) idle = setTimeout(() => {
        if (worker === current && !pending.size) { current.terminate(); worker = null; }
      }, 5000);
    };
    current.onerror = event => {
      if (worker !== current) return;
      clearTimeout(idle);
      for (const job of pending.values()) job.reject(Error(event.message || 'Shader analysis worker could not load or execute'));
      pending.clear(); current.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const token = ++id; pending.set(token, { resolve, reject });
    worker.postMessage({ id: token, op, code, defines });
  });
}
