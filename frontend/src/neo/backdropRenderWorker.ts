import { installNanotubes } from "./nanotubeRenderer";
import { installSilkFlow } from "./silkFlowRenderer";
import type { BackdropEnvironment } from "./backdropEnvironment";

type View = { width: number; height: number; dpr: number; unseen: boolean; reduced: boolean };
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void };
let view: View = { width: 1, height: 1, dpr: 1, unseen: false, reduced: false };
let stop: (() => void) | undefined;
let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
const seen = new Set<() => void>(), resize = new Set<() => void>(), scroll = new Set<(top: number) => void>(), pointer = new Set<(x: number, y: number) => void>();
const media = new EventTarget();
const subscribe = <T>(listeners: Set<T>, callback: T) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
const environment: BackdropEnvironment = {
  viewport: () => view, unseen: () => view.unseen,
  reduced: { get matches() { return view.reduced; }, addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media) },
  onSeen: callback => subscribe(seen, callback), onResize: callback => subscribe(resize, callback),
  onScroll: callback => subscribe(scroll, callback), onPointer: callback => subscribe(pointer, callback),
};

scope.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "init") {
    view = message.view;
    const offscreen = message.canvas as OffscreenCanvas;
    // The renderer sees the same canvas contract; only diagnostic state crosses
    // back to the DOM. Geometry, particles, textures and drawing stay in this worker.
    const dataset = new Proxy({} as DOMStringMap, { set(target, key: string, value: string) {
      if (target[key] !== value) { target[key] = value; scope.postMessage({ type: "metadata", key, value }); }
      return true;
    } });
    const canvas = {
      get width() { return offscreen.width; }, set width(value: number) { offscreen.width = value; dataset.renderWidth = String(value); },
      get height() { return offscreen.height; }, set height(value: number) { offscreen.height = value; dataset.renderHeight = String(value); },
      dataset,
      getContext(name: string, options: object) {
        context = offscreen.getContext(name as "webgl2", options) as WebGL2RenderingContext | null;
        return context;
      },
      addEventListener: offscreen.addEventListener.bind(offscreen), removeEventListener: offscreen.removeEventListener.bind(offscreen),
    } as unknown as HTMLCanvasElement;
    try {
      const install = message.kind === "silk" ? installSilkFlow : installNanotubes;
      stop = install(canvas, message.level, () => scope.postMessage({ type: "failure", phase: "runtime" }), () => scope.postMessage({ type: "restore" }), environment);
    } catch (error) {
      scope.postMessage({ type: "failure", phase: "init", error: error instanceof Error ? error.message.slice(0, 240) : "Renderer unavailable" });
    }
  } else if (message.type === "view") {
    const old = view; view = message.view;
    if (old.width !== view.width || old.height !== view.height || old.dpr !== view.dpr) resize.forEach(callback => callback());
    if (old.unseen !== view.unseen) seen.forEach(callback => callback());
    if (old.reduced !== view.reduced) media.dispatchEvent(new Event("change"));
  } else if (message.type === "input") {
    if (message.scroll != null) scroll.forEach(callback => callback(message.scroll));
    if (message.pointer) pointer.forEach(callback => callback(message.pointer[0], message.pointer[1]));
  } else if (message.type === "stop") {
    stop?.(); stop = undefined;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    scope.postMessage({ type: "stopped" });
  }
};
scope.postMessage({ type: "available", supported: typeof OffscreenCanvas !== "undefined" && typeof requestAnimationFrame === "function" });
