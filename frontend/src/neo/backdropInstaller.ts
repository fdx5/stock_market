import { browserBackdropEnvironment } from "./backdropEnvironment";
type Kind = "nanotube" | "silk";
type Level = "full" | "balanced" | "minimal";

/** Keeps GPU context creation, shader compilation and frame submission off the UI
 * thread when supported. Browser fallback uses the identical renderer and DPR. */
export function installBackdrop(canvas: HTMLCanvasElement, kind: Kind, level: Level,
  onFailure: () => void, onRestore: () => void, mainOnly = false, onMainFallback = onFailure, onUnavailable = onFailure) {
  let disposed = false, transferred = false, worker: Worker | null = null;
  let mainStop: (() => void) | undefined, inputFrame = 0;
  let input: { scroll?: number; pointer?: [number, number] } = {};
  let handshake: ReturnType<typeof setTimeout> | undefined;
  const removers: (() => void)[] = [];
  const environment = browserBackdropEnvironment();
  const view = () => ({ ...environment.viewport(), unseen: environment.unseen(), reduced: environment.reduced.matches });

  async function main() {
    try {
      const module = kind === "silk" ? await import("./silkFlowRenderer") : await import("./nanotubeRenderer");
      if (disposed) return;
      canvas.dataset.thread = "main";
      const install = "installSilkFlow" in module ? module.installSilkFlow : module.installNanotubes;
      mainStop = install(canvas, level, onFailure, onRestore);
    } catch (error) {
      if (disposed) return;
      if (error instanceof Error) canvas.dataset.rendererError = error.message.slice(0, 240);
      onUnavailable();
    }
  }
  function fallback() {
    clearTimeout(handshake); worker?.terminate(); worker = null;
    if (disposed) return;
    if (transferred) onMainFallback(); else void main();
  }
  function sendView() { if (transferred && !disposed) worker?.postMessage({ type: "view", view: view() }); }
  function sendInput() {
    if (inputFrame || disposed || !transferred) return;
    inputFrame = requestAnimationFrame(() => { inputFrame = 0; worker?.postMessage({ type: "input", ...input }); input = {}; });
  }
  if (!mainOnly && typeof Worker !== "undefined" && typeof canvas.transferControlToOffscreen === "function") {
    try {
      worker = new Worker(new URL("./backdropRenderWorker.ts", import.meta.url), { type: "module", name: "market-backdrop" });
      worker.onerror = fallback;
      worker.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        const message = event.data;
        if (message.type === "available") {
          clearTimeout(handshake);
          if (!message.supported) { fallback(); return; }
          try {
            const inputs = view();
            canvas.width = Math.round(inputs.width * inputs.dpr); canvas.height = Math.round(inputs.height * inputs.dpr);
            const offscreen = canvas.transferControlToOffscreen(); transferred = true;
            canvas.dataset.thread = "worker"; canvas.dataset.state = "loading";
            worker!.postMessage({ type: "init", canvas: offscreen, kind, level, view: inputs }, [offscreen]);
          } catch { fallback(); }
        } else if (message.type === "metadata") canvas.dataset[message.key] = message.value;
        else if (message.type === "restore") onRestore();
        else if (message.type === "failure") {
          if (message.error) canvas.dataset.rendererError = message.error;
          if (message.phase === "init") fallback(); else onFailure();
        }
      };
      handshake = setTimeout(fallback, 8000);
      removers.push(environment.onSeen(sendView), environment.onResize(sendView), environment.onScroll(top => { input.scroll = top; sendInput(); }));
      if (kind === "silk") removers.push(environment.onPointer((x, y) => { input.pointer = [x, y]; sendInput(); }));
      environment.reduced.addEventListener("change", sendView);
      removers.push(() => environment.reduced.removeEventListener("change", sendView));
      // DPR can change without a CSS-pixel resize when moving between displays.
      let density = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
      const densityChanged = () => { density.removeEventListener("change", densityChanged); density = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`); density.addEventListener("change", densityChanged); sendView(); };
      density.addEventListener("change", densityChanged); removers.push(() => density.removeEventListener("change", densityChanged));
    } catch { fallback(); }
  } else void main();
  return () => {
    disposed = true; clearTimeout(handshake); cancelAnimationFrame(inputFrame); removers.forEach(remove => remove()); mainStop?.();
    if (worker) {
      const retiring = worker; worker = null;
      const timeout = setTimeout(() => retiring.terminate(), 500);
      retiring.onmessage = event => { if (event.data.type === "stopped") { clearTimeout(timeout); retiring.terminate(); } };
      retiring.onerror = () => { clearTimeout(timeout); retiring.terminate(); };
      retiring.postMessage({ type: "stop" });
    }
  };
}
