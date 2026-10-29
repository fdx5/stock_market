import * as THREE from "three";

/* Every sign of a floor — room plates, shop fascias, the exit signs, the floor directory — painted on
 * one canvas, so they are one material and draw in the room batches like the walls. Korean type in
 * the system's sans (Pretendard / Noto Sans KR where present). */

export type SignStyle = "plate" | "fascia" | "exit" | "directory" | "lift" | "brand" | "label" | "number" | "notice";
const FONT = `Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

export class SignAtlas {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshPhysicalMaterial;
  private g: CanvasRenderingContext2D;
  private x = 0; private y = 0; private rowH = 0;
  /** signs painted already (a large floor repeats 비상구, 화장실, the lift numbers): their places */
  private made = new Map<string, [number, number, number, number]>();
  constructor(readonly accent: string, size = 2048) {
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext("2d")!;
    this.g.fillStyle = "#808080"; this.g.fillRect(0, 0, size, size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    // (lit by the room, glowing a little of its own: a backlit plate reads in a dim corridor)
    this.material = new THREE.MeshPhysicalMaterial({ map: this.texture, emissiveMap: this.texture, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.32, roughness: 0.45, clearcoat: 0.4 });
  }
  private alloc(w: number, h: number): [number, number] | null {
    const S = this.canvas.width;
    if (this.x + w > S) { this.x = 0; this.y += this.rowH + 4; this.rowH = 0; }
    if (this.y + h > S - 6) return null;
    const at: [number, number] = [this.x, this.y];
    this.x += w + 4; this.rowH = Math.max(this.rowH, h);
    return at;
  }
  /** paint a sign (`lines`: its text, the first the main one) of the given aspect; its plane, w × h m, UV-mapped to it */
  sign(style: SignStyle, lines: string[], w: number, h: number): THREE.PlaneGeometry {
    // (the atlas two thirds full — a large floor's hundreds of rooms — the rest at half the detail,
    // still read from a few metres)
    const S0 = this.canvas.width, ppm = (style === "directory" ? 300 : 360) * (this.y > S0 * 0.66 ? 0.5 : 1);
    let pw = Math.min(1024, Math.round(w * ppm)), ph = Math.round(pw * h / w);
    if (ph > 1024) { ph = 1024; pw = Math.round(ph * w / h); }
    const geo = new THREE.PlaneGeometry(w, h);
    const mapTo = (x: number, y: number, pw: number, ph: number) => {
      const S = this.canvas.width, u0 = x / S, u1 = (x + pw) / S, v1 = 1 - y / S, v0 = 1 - (y + ph) / S;
      const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      return geo;
    };
    const key = `${style}|${lines.join("|")}|${(w / h).toFixed(2)}`, had = this.made.get(key);
    if (had) return mapTo(...had);
    const at = this.alloc(pw, ph);
    // (full: a plain plate of the accent's grey, never the whole atlas squeezed onto it)
    if (!at) return mapTo(this.canvas.width - 3, this.canvas.height - 3, 2, 2);
    this.made.set(key, [at[0], at[1], pw, ph]);
    const [x, y] = at, g = this.g;
    g.save(); g.translate(x, y);
    const dark = "#1d2126", light = "#f4f5f3";
    const bg = style === "exit" ? "#11a14a" : style === "plate" || style === "label" ? light : style === "notice" ? "#fff8e6" : style === "lift" ? "#0b0d10" : style === "number" ? "#0b0d10" : style === "brand" ? "#e8e6e1" : style === "directory" ? "#22262c" : this.accent;
    const fg = style === "exit" ? "#ffffff" : style === "plate" || style === "label" || style === "notice" || style === "brand" ? dark : style === "lift" || style === "number" ? "#ff8a2a" : light;
    g.fillStyle = bg; g.fillRect(0, 0, pw, ph);
    if (style === "plate") { g.fillStyle = this.accent; g.fillRect(0, 0, Math.max(6, pw * 0.04), ph); }
    if (style === "fascia") { const gr = g.createLinearGradient(0, 0, 0, ph); gr.addColorStop(0, "rgba(255,255,255,.12)"); gr.addColorStop(1, "rgba(0,0,0,.18)"); g.fillStyle = gr; g.fillRect(0, 0, pw, ph); }
    g.fillStyle = fg; g.textBaseline = "middle";
    const fit = (t: string, size: number, maxW: number, weight = 700) => { let s = size; g.font = `${weight} ${s}px ${FONT}`; while (g.measureText(t).width > maxW && s > 8) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; } return s; };
    if (style === "exit") {
      // the running figure and the door, and 비상구
      const s = ph * 0.8, ox = ph * 0.15, oy = ph * 0.1;
      g.strokeStyle = "#ffffff"; g.lineWidth = s * 0.08; g.lineCap = "round";
      g.strokeRect(pw - ph * 0.95, oy, s * 0.55, s);
      g.beginPath(); g.arc(ox + s * 0.42, oy + s * 0.14, s * 0.09, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(ox + s * 0.38, oy + s * 0.27); g.lineTo(ox + s * 0.3, oy + s * 0.58); g.lineTo(ox + s * 0.5, oy + s * 0.75); g.lineTo(ox + s * 0.46, oy + s * 0.96);
      g.moveTo(ox + s * 0.3, oy + s * 0.58); g.lineTo(ox + s * 0.12, oy + s * 0.92); g.moveTo(ox + s * 0.36, oy + s * 0.36); g.lineTo(ox + s * 0.58, oy + s * 0.5); g.moveTo(ox + s * 0.36, oy + s * 0.36); g.lineTo(ox + s * 0.14, oy + s * 0.46); g.stroke();
      fit("비상구", ph * 0.5, pw - ph * 2.1, 800); g.textAlign = "center"; g.fillText("비상구", pw / 2, ph / 2);
    } else if (style === "directory") {
      g.textAlign = "left";
      fit(lines[0] ?? "", ph * 0.08, pw * 0.9, 800); g.fillText(lines[0] ?? "", pw * 0.06, ph * 0.08);
      g.fillStyle = this.accent; g.fillRect(pw * 0.06, ph * 0.14, pw * 0.88, 3);
      const rows = lines.slice(1), rh = Math.min(ph * 0.075, (ph * 0.82) / Math.max(1, rows.length));
      rows.forEach((r, i) => {
        const [fl, ...rest] = r.split("\t"), yy = ph * 0.17 + rh * (i + 0.5);
        g.fillStyle = "#ff9f43"; fit(fl, rh * 0.62, pw * 0.2, 800); g.fillText(fl, pw * 0.06, yy);
        g.fillStyle = light; fit(rest.join(" "), rh * 0.55, pw * 0.66, 500); g.fillText(rest.join(" "), pw * 0.28, yy);
      });
    } else {
      g.textAlign = "center";
      const main = lines[0] ?? "", sub = lines[1];
      const pad = style === "plate" ? pw * 0.1 : pw * 0.06;
      if (sub) { fit(main, ph * 0.42, pw - 2 * pad, 800); g.fillText(main, pw / 2 + (style === "plate" ? pw * 0.02 : 0), ph * 0.4); g.globalAlpha = 0.72; fit(sub, ph * 0.22, pw - 2 * pad, 500); g.fillText(sub, pw / 2, ph * 0.76); g.globalAlpha = 1; }
      else { fit(main, ph * (style === "number" || style === "lift" ? 0.7 : 0.55), pw - 2 * pad, style === "brand" ? 900 : 800); g.fillText(main, pw / 2 + (style === "plate" ? pw * 0.02 : 0), ph / 2); }
    }
    g.restore();
    this.texture.needsUpdate = true;
    return mapTo(x, y, pw, ph);
  }
  dispose() { this.texture.dispose(); this.material.dispose(); }
}

/** what a monitor shows: a working screen (a sheet, a chart, a mail list), painted once */
export function monitorTexture(accent: string): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 512; c.height = 300;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3f5f8"; g.fillRect(0, 0, 512, 300);
  g.fillStyle = accent; g.fillRect(0, 0, 512, 22);
  g.fillStyle = "#e1e6ec"; g.fillRect(0, 22, 92, 278);
  for (let i = 0; i < 9; i++) { g.fillStyle = i === 2 ? "#c9d6e6" : "#d3d9e0"; g.fillRect(10, 36 + i * 26, 70, 12); }
  g.strokeStyle = "#d5dae0"; for (let r = 0; r < 12; r++) { g.beginPath(); g.moveTo(100, 40 + r * 20); g.lineTo(505, 40 + r * 20); g.stroke(); }
  for (let col = 0; col < 5; col++) { g.beginPath(); g.moveTo(100 + col * 81, 30); g.lineTo(100 + col * 81, 280); g.stroke(); }
  g.fillStyle = "#8a96a3"; for (let r = 0; r < 11; r++) for (let col = 0; col < 5; col++) g.fillRect(106 + col * 81, 46 + r * 20, 20 + ((r * 7 + col * 13) % 45), 7);
  g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < 12; i++) g.lineTo(330 + i * 14, 250 - Math.sin(i * 0.8) * 20 - i * 4); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
