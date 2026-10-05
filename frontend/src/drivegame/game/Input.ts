import type { Controls } from "../vehicle/physics";

/* Keyboard (by key position: a Korean layout types ㅈ for W), a gamepad (standard mapping: right
 * trigger throttle, left trigger brake, left stick steering, A handbrake, B boost), and touch
 * pedals from the page — merged into one set of controls each frame. */

export type Action = "pause" | "view" | "horn" | "voice" | "reset" | "map";

export class Input {
  private keys = new Set<string>();
  private touch: Partial<Record<"up" | "down" | "left" | "right" | "hand" | "boost", boolean>> = {};
  private padPrev: boolean[] = [];
  /** steering eased toward the keys (a key is all or nothing; a wheel isn't) */
  private steer = 0;
  usedPad = false;
  constructor(private onAction: (a: Action) => void) {
    window.addEventListener("keydown", this.down, true);
    window.addEventListener("keyup", this.up, true);
    window.addEventListener("blur", this.blur);
  }
  private down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act: Record<string, Action> = { Escape: "pause", KeyP: "pause", KeyV: "view", KeyC: "view", KeyH: "horn", KeyM: "voice", KeyR: "reset", KeyN: "map" };
    if (act[e.code]) { e.preventDefault(); if (!e.repeat) this.onAction(act[e.code]); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(e.code)) { e.preventDefault(); this.keys.add(e.code); }
  };
  private up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private blur = () => { this.keys.clear(); this.touch = {}; };
  setTouch(k: keyof Input["touch"], on: boolean) { this.touch[k] = on; }
  get anyDrive() { const c = this.read(0); return c.throttle > 0.1 || c.brake > 0.1 || Math.abs(c.steer) > 0.1; }

  /** The controls now (dt: seconds since the last read, for the keys' steering ease). */
  read(dt: number): Controls {
    const k = this.keys, t = this.touch;
    let throttle = k.has("KeyW") || k.has("ArrowUp") || t.up ? 1 : 0;
    let brake = k.has("KeyS") || k.has("ArrowDown") || t.down ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") || t.left, right = k.has("KeyD") || k.has("ArrowRight") || t.right;
    let hand = k.has("Space") || !!t.hand, boost = k.has("ShiftLeft") || k.has("ShiftRight") || !!t.boost;
    const want = (left ? 1 : 0) - (right ? 1 : 0);
    // (keys: the wheel turns in over ~0.25 s and back faster)
    const rate = want ? 5 : 8;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, want - this.steer));
    let steer = this.steer;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] ?? 0, rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      if (Math.abs(ax) > 0.12 || rt > 0.05 || lt > 0.05) this.usedPad = true;
      if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
      throttle = Math.max(throttle, rt); brake = Math.max(brake, lt);
      hand ||= !!p.buttons[0]?.pressed; boost ||= !!p.buttons[1]?.pressed;
      const edge = (i: number, a: Action) => { const on = !!p.buttons[i]?.pressed; if (on && !this.padPrev[i]) this.onAction(a); this.padPrev[i] = on; };
      edge(9, "pause"); edge(3, "view"); edge(2, "horn"); edge(8, "map"); edge(4, "reset");
      break;
    }
    return { throttle, brake, steer, hand, boost };
  }
  dispose() {
    window.removeEventListener("keydown", this.down, true);
    window.removeEventListener("keyup", this.up, true);
    window.removeEventListener("blur", this.blur);
  }
}
