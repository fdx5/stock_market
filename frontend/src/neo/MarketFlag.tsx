import { useEffect, useRef } from "react";

// Project narrow strips of the original flag onto a travelling cloth wave.
// Displacement and fold contrast both vanish at the hoist.
export default function MarketFlag({code, large = false}: {code: string; large?: boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = `/img/world-flags/${code.toLowerCase()}.svg`;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const host = el.parentElement!;
    const img = new Image();
    const texture = document.createElement("canvas");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, visible = false, disposed = false, last = 0;
    const seed = (code.charCodeAt(0) * 11 + code.charCodeAt(1)) * .37 + (large ? .8 : 0);
    function draw(now: number) {
      frame = 0;
      if (!el || !ctx || disposed || !visible || document.hidden || motion.matches || !img.naturalWidth) return;
      frame = requestAnimationFrame(draw);
      if (now - last < 32) return;
      last = now;
      const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!w || !h) return;
      if (el.width !== Math.round(w*dpr) || el.height !== Math.round(h*dpr)) {
        el.width = Math.round(w*dpr);
        el.height = Math.round(h*dpr);
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,w,h);
      const width = Math.min(w * .95, h * .78 * img.naturalWidth / img.naturalHeight);
      const height = width * img.naturalHeight / img.naturalWidth;
      const t = now * .001, wind = t * 2.6 + .65 * Math.sin(t * .76 + seed) + seed;
      const gust = .78 + .22 * Math.sin(t * .92 + seed);
      const textureWidth = Math.max(1, Math.ceil(width * dpr));
      if (texture.width !== textureWidth || texture.height !== Math.ceil(height * dpr)) {
        texture.width = textureWidth;
        texture.height = Math.ceil(height * dpr);
        texture.getContext("2d")?.drawImage(img, 0, 0, texture.width, texture.height);
      }
      const steps = Math.ceil(width / 1.5);
      const edge = (u: number) => width * u * (1 - .045 * u * (1 + Math.cos(6.2 * u - wind)));
      for (let i = 0; i < steps; i++) {
        const u = i / steps, phase = u * 6.2 - wind;
        const wave = Math.sin(phase) + .23 * Math.sin(phase * 1.83 + t * .38);
        const x = edge(u), dx = edge((i + 1) / steps) - x + .35;
        const y = (h - height) / 2 + height * u * (.12 * gust * wave + .025 * u);
        const stripHeight = height * (1 - .035 * u * Math.cos(phase));
        ctx.drawImage(texture, u * texture.width, 0, texture.width / steps, texture.height, x, y, dx, stripHeight);
        const slope = Math.cos(phase) * u * gust;
        ctx.fillStyle = slope < 0 ? `rgba(0,0,0,${-slope*.26})` : `rgba(255,255,255,${slope*.18})`;
        ctx.fillRect(x,y,dx,stripHeight);
      }
      host.dataset.waving = "true";
    }
    function sync() {
      cancelAnimationFrame(frame);
      if (motion.matches) delete host.dataset.waving;
      draw(performance.now());
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(el);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    img.onload = sync;
    img.src = src;
    return () => {
      disposed = true;
      delete host.dataset.waving;
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [src, code, large]);
  return <span aria-hidden="true" className={`wm-flag${large ? " wm-flag-large" : ""}`}><img src={src} alt=""/><canvas key={code} ref={canvas}/></span>;
}
