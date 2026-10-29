import * as THREE from "three";
import { DRINKS, type Drink } from "./drinks";
const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';

/** Recognisable brand colours/lettering reconstructed as code-native labels, not product photos. */
export function paintDrink(g: CanvasRenderingContext2D, d: Drink, w: number, h: number) {
  g.save(); g.scale(w / 240, h / 360); g.fillStyle = d.color; g.fillRect(0, 0, 240, 360);
  const text = (s: string, y: number, size: number, color = "white", weight = "900") => { g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `${weight} ${size}px ${FONT}`; g.fillText(s, 120, y, 215); };
  const wave = (color: string, y: number, thickness = 24) => { g.strokeStyle = color; g.lineWidth = thickness; g.beginPath(); g.moveTo(-30, y + 28); g.bezierCurveTo(45, y + 55, 130, y - 45, 270, y - 10); g.stroke(); };
  if (d.brand === "cider") {
    text("Chilsung", 72, 24); text("CIDER", 128, 55);
    g.fillStyle = "#ffffff"; g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 25 : 63; g.lineTo(120 + Math.cos(a) * r, 215 + Math.sin(a) * r); } g.closePath(); g.fill();
    text("칠성사이다", 303, 32); wave("#8ddbc3", 350, 8);
  } else if (d.brand === "mccol") {
    g.fillStyle = "#f4f4e5"; g.fillRect(0, 0, 240, 170); wave("#074e9b", 170, 90);
    text("맥콜", 111, 86, "#084c92"); text("McCOL", 210, 49); text("보리 탄산음료", 290, 22, "#604315");
    g.strokeStyle = "#987526"; g.lineWidth = 4; for (const x of [38, 202]) { g.beginPath(); g.moveTo(x, 350); g.lineTo(x + 8, 262); for (let j = 0; j < 5; j++) { const y = 272 + j * 12; g.moveTo(x + 6, y); g.lineTo(x - 5, y - 10); g.moveTo(x + 6, y); g.lineTo(x + 18, y - 9); } g.stroke(); }
  } else if (d.brand === "pepsi") {
    g.save(); g.translate(120, 160); g.beginPath(); g.arc(0, 0, 79, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#ffffff"; g.fillRect(-80, -80, 160, 160); g.fillStyle = "#ed2436"; g.beginPath(); g.moveTo(-90, -90); g.lineTo(90, -90); g.lineTo(90, -16); g.bezierCurveTo(20, -50, -30, 40, -90, 3); g.closePath(); g.fill();
    g.fillStyle = "#0755ae"; g.beginPath(); g.moveTo(-90, 30); g.bezierCurveTo(-20, 70, 30, -22, 90, 12); g.lineTo(90, 90); g.lineTo(-90, 90); g.closePath(); g.fill(); g.restore();
    text("PEPSI", 163, 29, "#111721"); text(d.zero ? "ZERO SUGAR" : "PEPSI COLA", 286, 25);
  } else if (d.brand === "coke") {
    text(d.zero ? "ZERO SUGAR" : "ORIGINAL TASTE", 60, 18);
    g.save(); g.translate(120, 180); g.rotate(-.14); g.fillStyle = "white"; g.font = `italic 900 55px ${FONT}`; g.textAlign = "center"; g.fillText("Coca-Cola", 0, 0, 225); g.restore();
    wave("#ffffff", 246, 12); wave("#ffffff88", 267, 3); text("코카-콜라", 321, 23);
  } else if (d.brand === "fanta") {
    g.fillStyle = "#ffffff22"; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc((i * 71) % 240, (i * 43) % 360, 15 + i % 3 * 5, 0, Math.PI * 2); g.fill(); }
    g.save(); g.translate(120, 171); g.rotate(-.12); g.fillStyle = "#ffffff"; g.font = `900 70px ${FONT}`; g.textAlign = "center"; g.strokeStyle = "#172b73"; g.lineWidth = 15; g.strokeText("FANTA", 0, 0, 220); g.fillText("FANTA", 0, 0, 220); g.restore();
    g.fillStyle = "#50ac43"; g.beginPath(); g.ellipse(151, 91, 36, 14, -.45, 0, Math.PI * 2); g.fill(); text(d.id === "fanta-grape" ? "GRAPE" : "ORANGE", 277, 27); text("환타", 319, 23);
  } else if (d.brand === "sprite") { wave("#e5ed38", 197, 58); text("Sprite", 166, 66, "#ffffff", "italic 900"); text("스프라이트", 283, 29); }
  else if (d.brand === "milkis") { wave("#2584cf", 260, 105); text("밀키스", 109, 53, "#095aa7"); text("Milkis", 181, 50, "#095aa7", "italic 900"); text("MILK SODA", 291, 22); }
  else if (d.brand === "demisoda") { text("DemiSoda", 120, 43); text("데미소다", 192, 39); text("APPLE", 284, 30); }
  else if (d.brand === "oranc") { text("오란씨", 126, 67, "#e84120"); text("OranC", 200, 44, "#1c673c"); text("PINEAPPLE", 283, 22, "#1c673c"); }
  else { wave("#ffffff33", 280, 95); text(d.group.toUpperCase(), 66, 24); const t = d.name.split(" "); text(t[0], 157, 37); if (t[1]) text(t.slice(1).join(" "), 202, 30); text("CHILLED DRINK", 300, 17); }
  if (d.zero) { g.fillStyle = "#10151b"; g.fillRect(0, 328, 240, 32); text("ZERO SUGAR", 345, 17); }
  g.restore();
}

export function paintCanPreview(c: HTMLCanvasElement, d: Drink) {
  c.width = 144; c.height = 204; const g = c.getContext("2d")!;
  g.clearRect(0, 0, 144, 204); g.save(); g.beginPath(); g.roundRect(24, 13, 96, 180, 14); g.clip();
  g.translate(24, 13); paintDrink(g, d, 96, 180);
  const gr = g.createLinearGradient(0, 0, 96, 0); gr.addColorStop(0, "#0007"); gr.addColorStop(.23, "#fff3"); gr.addColorStop(.55, "#fff0"); gr.addColorStop(1, "#0009"); g.fillStyle = gr; g.fillRect(0, 0, 96, 180); g.restore();
  for (const y of [14, 192]) { g.fillStyle = "#c6d1db"; g.beginPath(); g.ellipse(72, y, 44, 6, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#657b8b"; g.stroke(); }
  g.strokeStyle = "#73899a"; g.lineWidth = 3; g.beginPath(); g.ellipse(74, 13, 10, 3.5, 0, 0, Math.PI * 2); g.stroke();
}

/** One bounded texture for every branded can on a floor. Geometry selects its atlas cell. */
export class DrinkAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshPhysicalMaterial;
  constructor() {
    const c = document.createElement("canvas"); c.width = 2048; c.height = 1024; const g = c.getContext("2d")!;
    DRINKS.forEach((d, i) => { const x = i % 6 * 336, y = Math.floor(i / 6) * 168; g.save(); g.translate(x, y); g.fillStyle = d.color; g.fillRect(0, 0, 336, 168); for (const dx of [0, 168]) { g.save(); g.translate(dx + 4, 4); paintDrink(g, d, 160, 160); g.restore(); } g.restore(); });
    this.texture = new THREE.CanvasTexture(c); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    this.material = new THREE.MeshPhysicalMaterial({ map: this.texture, metalness: .35, roughness: .28, clearcoat: .65 });
  }
  geometry(drink: Drink, radius = .048, height = .145) {
    const i = Math.max(0, DRINKS.findIndex(d => d.id === drink.id)), g = new THREE.CylinderGeometry(radius, radius, height, 24, 1, true).rotateY(-Math.PI / 2), uv = g.getAttribute("uv");
    for (let n = 0; n < uv.count; n++) uv.setXY(n, (i % 6 * 336 + 4 + uv.getX(n) * 328) / 2048, 1 - (Math.floor(i / 6) * 168 + 4 + (1 - uv.getY(n)) * 160) / 1024);
    return g;
  }
  dispose() { this.material.dispose(); this.texture.dispose(); }
}
