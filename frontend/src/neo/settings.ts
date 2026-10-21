import { useSyncExternalStore } from "react";

export type FxLevel = "full" | "balanced" | "minimal";
export type DesignMode = "neo" | "classic";
const listeners = new Set<() => void>();
let design: DesignMode = "neo";
let fx: FxLevel = "balanced";
let frameLight = true;
if (typeof window !== "undefined") {
  try {
    const query = new URLSearchParams(window.location.search).get("design");
    const saved = window.sessionStorage.getItem("kospimap_design_preview");
    design = query === "classic" || query === "neo" ? query : saved === "classic" || saved === "neo" ? saved : "neo";
    if (query === "classic" || query === "neo") window.sessionStorage.setItem("kospimap_design_preview", query);
    const level = window.localStorage.getItem("kospimap_fx");
    if (level === "full" || level === "minimal") fx = level;
    frameLight = window.localStorage.getItem("kospimap_frame_light") !== "off";
  } catch { /* An unavailable storage area never prevents rendering. */ }
}
function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.design = design;
  document.documentElement.dataset.fx = fx;
  document.documentElement.dataset.frameLight = frameLight ? "on" : "off";
  if (design === "neo" && !document.getElementById("neo-brand-icon")) {
    const icon = document.createElement("link");
    icon.id = "neo-brand-icon"; icon.rel = "icon"; icon.type = "image/svg+xml"; icon.href = "/neo/kstock-symbol.svg";
    document.head.appendChild(icon);
  } else if (design !== "neo") document.getElementById("neo-brand-icon")?.remove();
}
apply();
export function isNeoDesign() { return design === "neo"; }
export function subscribeDesignSettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setDesignMode(mode: DesignMode) {
  design = mode;
  try { window.sessionStorage.setItem("kospimap_design_preview", mode); } catch { /* in-memory preference */ }
  apply(); listeners.forEach(listener => listener());
}
export function setFxLevel(level: FxLevel) {
  fx = level;
  try { window.localStorage.setItem("kospimap_fx", level); } catch { /* in-memory preference */ }
  apply(); listeners.forEach(listener => listener());
}
export function useDesignMode() { return useSyncExternalStore(subscribeDesignSettings, () => design, () => "classic" as DesignMode); }
export function useFxLevel() { return useSyncExternalStore(subscribeDesignSettings, () => fx, () => "balanced" as FxLevel); }
export function setFrameLight(value: boolean) { frameLight = value; try { window.localStorage.setItem("kospimap_frame_light", value ? "on" : "off"); } catch { /* in-memory preference */ } apply(); listeners.forEach(listener => listener()); }
export function useFrameLight() { return useSyncExternalStore(subscribeDesignSettings, () => frameLight, () => true); }
