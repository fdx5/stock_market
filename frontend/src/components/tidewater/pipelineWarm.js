import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';

/* The view's render pipelines compiled ahead, on the map page, before a complex is chosen.
 *
 * A first visit spent ~1 s between the model built and its first frame compiling ~60 pipelines
 * (and the GPU process, busy compiling, held frames back). The browser keeps compiled shaders by
 * their content, so pipelines made here from the same shader code and state — the descriptors a
 * real load made, recorded in /3d/pipelines.json (scripts/capture-pipelines.py) — make the view's
 * own compile a cache hit: 1.0-1.2 s -> ~0.3 s from built to shown, on a complex the manifest was
 * not recorded from (measured 2026-10-05).
 *
 * One pipeline at a time in the page's idle time, starting a while after the map settles, and
 * none once a view starts (it compiles what it needs itself). A manifest out of step with the
 * shaders only misses: nothing it makes is used, and its errors are kept to itself. */

let stopped = false, started = false;

/** A view is starting: stop compiling ahead (sceneWork and its own pipelines come first). */
export function stopPipelineWarm() { stopped = true; }

const idle = () => new Promise(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 3000 });
  else setTimeout(resolve, 60);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Starts once per page, after `delay` ms; GPU.device must be made (warmDevice). */
export function warmPipelines(delay = 4000) {
  if (started) return;
  started = true;
  void (async () => {
    await pause(delay);
    if (stopped || !GPU.device || GPU.adapter?.info?.isFallbackAdapter) return;
    const res = await fetch('/3d/pipelines.json', { priority: 'low' }).catch(() => null);
    if (!res?.ok || stopped) return;
    const M = await res.json().catch(() => null);
    if (!M?.pipelines || stopped) return;
    const d = GPU.device;
    const modules = new Map(), groups = new Map(), layouts = new Map();
    const module = h => { if (!modules.has(h)) modules.set(h, d.createShaderModule({ code: M.modules[h] })); return modules.get(h); };
    const group = h => { if (!groups.has(h)) groups.set(h, d.createBindGroupLayout(M.bgls[h])); return groups.get(h); };
    const layout = h => { if (!layouts.has(h)) layouts.set(h, d.createPipelineLayout({ bindGroupLayouts: M.layouts[h].map(group) })); return layouts.get(h); };
    const stage = s => s && { ...s, module: module(s.module) };
    for (const p of M.pipelines) {
      await idle();
      if (stopped || GPU.device !== d) return;
      while (document.hidden) await new Promise(resolve => document.addEventListener('visibilitychange', resolve, { once: true }));
      if (stopped) return;
      // (the shader modules and layouts are made here, synchronously, inside the scope: nothing
      // else's errors land in them; the compile itself rejects instead)
      d.pushErrorScope('validation');
      let desc = null;
      try {
        desc = { layout: p.layout === 'auto' ? 'auto' : layout(p.layout), vertex: stage(p.vertex), primitive: p.primitive, depthStencil: p.depthStencil, multisample: p.multisample };
        if (p.fragment) desc.fragment = stage(p.fragment);
      } catch { desc = null; }
      const invalid = await d.popErrorScope().catch(() => null);
      if (!desc || invalid) continue;
      await d.createRenderPipelineAsync(desc).catch(() => null); // (one this device can't make: the view won't ask for it either)
    }
  })().catch(() => {});
}
