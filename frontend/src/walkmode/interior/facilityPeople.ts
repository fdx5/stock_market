import * as THREE from "three";
import { Avatar } from "../player/avatar";
import type { Spot } from "./facilityFurnish";
import type { Interactable } from "./furnish";
import type { FacilityRole, FloorPlan, Opening, Room } from "./plan/types";

/* The people of a building's floor: those at their places (the team at its desks, the doctor at the
 * consulting desk, the clerks behind the counters, patients in the beds, visitors on the benches)
 * and those going about — down the corridor to a room's door, waiting there, on to the lifts. Each
 * can be spoken to: they turn to the visitor and answer as their part would. They keep out of the
 * visitor's way (they stop, and the visitor is kept off them). */

const OUTFIT: Partial<Record<FacilityRole, { top: string; bottom: string; shoe?: string }>> = {
  doctor: { top: "#f4f4f1", bottom: "#2c3442" }, nurse: { top: "#9cc7d9", bottom: "#9cc7d9", shoe: "#ffffff" },
  clerk: { top: "#2f3d55", bottom: "#23272e" }, guard: { top: "#1f2a3a", bottom: "#1b2029", shoe: "#111111" },
  cook: { top: "#f2f2ee", bottom: "#2a2a2a" }, patient: { top: "#a9c4dc", bottom: "#a9c4dc" },
  student: { top: "#2b3a55", bottom: "#6d7685" }, teacher: { top: "#6b5b4b", bottom: "#2d3036" },
};
const LINES: Record<FacilityRole, string[]> = {
  desk: ["안녕하세요. 무슨 일로 오셨어요?", "지금 회의 자료 정리 중이에요.", "담당자는 저쪽 자리에 계세요."],
  clerk: ["어서 오세요. 무엇을 도와드릴까요?", "번호표 뽑고 잠시만 기다려 주세요.", "안내 데스크입니다. 엘리베이터는 복도 끝에 있어요."],
  doctor: ["어디가 불편하세요?", "진료는 접수 후 순서대로 봐 드려요.", "처방전은 1층 약국에서 받으시면 됩니다."],
  nurse: ["성함 확인 도와드릴게요.", "잠시 후 이름 부르면 들어오세요.", "주사실은 복도 오른쪽입니다."],
  patient: ["접수하고 기다리는 중이에요.", "오늘은 대기가 좀 길어요.", "…"],
  visitor: ["안녕하세요.", "엘리베이터가 어디 있는지 아세요?", "여기 처음 와 봤어요."],
  student: ["쉬는 시간이에요.", "다음 수업 준비 중이에요.", "시험 기간이라 바빠요."],
  teacher: ["수업은 10분 뒤에 시작해요.", "상담은 교무실로 오세요.", "자리에 앉아 주세요."],
  shopper: ["구경 중이에요.", "여기 물건 괜찮네요.", "계산은 저쪽에서 해요."],
  guard: ["출입증 확인 부탁드립니다.", "엘리베이터는 홀 안쪽에 있습니다.", "비상구는 복도 양 끝입니다."],
  cook: ["주문하신 거 곧 나와요.", "오늘의 메뉴 괜찮아요.", "어서 오세요!"],
  guest: ["체크인하고 올라왔어요.", "전망이 좋네요.", "조식은 몇 시부터예요?"],
};
/** what each part sits or stands at, by preference */
const PLACES: Record<FacilityRole, Spot["kind"][]> = {
  desk: ["desk"], clerk: ["counter"], doctor: ["doctor", "desk"], nurse: ["stand", "counter"], patient: ["bed", "seat", "stand"],
  visitor: ["seat", "stand"], student: ["desk", "seat"], teacher: ["stand", "desk"], shopper: ["stand", "seat"], guard: ["stand", "counter"],
  cook: ["counter"], guest: ["desk", "seat"],
};

interface Person {
  av: Avatar; role: FacilityRole; room: Room; spot?: Spot;
  pos: THREE.Vector2; face: number; pose: "sit" | "stand" | "lie"; y: number;
  path: THREE.Vector2[]; wait: number; speed: number; bubble: THREE.Sprite | null; bubbleT: number; turnTo: number | null; seed: number; line: number;
}

export class People {
  readonly root = new THREE.Group();
  private people: Person[] = [];
  private bubbleTex: THREE.CanvasTexture[] = [];
  /** points on the corridor and the halls the walkers go between */
  private nodes: { p: THREE.Vector2; room: string }[] = [];
  private corridorY: number; private corridor: Room | undefined;

  constructor(private plan: FloorPlan, spots: Spot[], private speak: () => void) {
    const fac = plan.facility!, used = new Set<Spot>();
    let seed = Math.abs([...`${plan.complexId}|${fac.level}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    this.corridor = plan.rooms.find(r => r.id === "corridor");
    const cr = this.corridor?.rect ?? plan.bounds; this.corridorY = (cr[1] + cr[3]) / 2;
    // the doors off the corridor: just outside each, a place walkers go to
    for (const o of plan.openings) {
      if (o.type === "window" || (o.a !== "corridor" && o.b !== "corridor")) continue;
      const other = o.a === "corridor" ? o.b : o.a;
      if (other === "out") continue;
      this.nodes.push({ p: this.doorPoint(o), room: other });
    }
    const atSpot = new Map<string, Spot[]>();
    for (const s of spots) { const l = atSpot.get(s.room.id) ?? []; l.push(s); atSpot.set(s.room.id, l); }
    // (a busy floor but not a crowd: ~12 at most, the rest of the parts left out)
    const cap = 12;
    for (const want of fac.people) {
      if (this.people.length >= cap) break;
      const room = plan.rooms.find(r => r.id === want.room); if (!room) continue;
      const free = (atSpot.get(room.id) ?? []).filter(s => !used.has(s));
      const s = PLACES[want.role].map(k => free.find(f => f.kind === k)).find(Boolean);
      const walker = !s && (room.id === "corridor" || room.type === "lobby" || room.type === "liftHall" || room.type === "waiting" || room.type === "gallery" || room.type === "shop" || room.type === "parking");
      if (!s && !walker) continue;
      if (s) used.add(s);
      const av = new Avatar(1 + Math.floor(rnd() * 9999), OUTFIT[want.role]);
      av.shoes(true);
      const p: Person = { av, role: want.role, room, spot: s, pos: new THREE.Vector2(s?.x ?? 0, s?.z ?? 0), face: s?.face ?? 0, pose: s?.pose ?? "stand", y: s?.y ?? 0,
        path: [], wait: rnd() * 4, speed: 1.05 + rnd() * 0.35, bubble: null, bubbleT: 0, turnTo: null, seed: Math.floor(rnd() * 1000), line: 0 };
      if (walker) { const n = this.nodes[Math.floor(rnd() * this.nodes.length)]; if (!n) continue; p.pos.copy(n.p); p.pose = "stand"; p.spot = undefined; }
      av.pose = p.pose === "lie" ? "stand" : p.pose;
      this.root.add(av.root);
      this.people.push(p);
      this.place(p, 0);
    }
  }

  /** a point in the corridor 0.8 m off a door's middle */
  private doorPoint(o: Opening): THREE.Vector2 {
    const cr = this.corridor?.rect;
    if (o.axis === "z") return new THREE.Vector2(o.center, cr ? THREE.MathUtils.clamp(o.at + (this.corridorY > o.at ? 0.8 : -0.8), cr[1] + 0.5, cr[3] - 0.5) : o.at);
    return new THREE.Vector2(cr ? THREE.MathUtils.clamp(o.at + (o.at < (cr[0] + cr[2]) / 2 ? 0.8 : -0.8), cr[0] + 0.5, cr[2] - 0.5) : o.at, o.center);
  }

  get count() { return this.people.length; }
  /** for the visitor's collisions: who stands where */
  circles(): { x: number; z: number; r: number }[] { return this.people.filter(p => p.pose !== "lie").map(p => ({ x: p.pos.x, z: p.pos.y, r: p.pose === "sit" ? 0.2 : 0.28 })); }

  interactables(roomOf: (x: number, z: number) => Room | null): Interactable[] {
    return this.people.map((p, i) => {
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.7, 10), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.85; p.av.root.add(hit);
      return {
        id: `person-${i}`, zone: 0, room: roomOf(p.pos.x, p.pos.y) ?? p.room, hit,
        label: () => `${this.title(p)}에게 말 걸기`,
        act: () => { this.talk(p); return null; },
      } satisfies Interactable;
    });
  }
  private title(p: Person) {
    return { desk: "직원", clerk: "안내 직원", doctor: "의사", nurse: "간호사", patient: "환자", visitor: "방문객", student: "학생", teacher: "선생님", shopper: "손님", guard: "보안 요원", cook: "요리사", guest: "투숙객" }[p.role];
  }
  private visitor = new THREE.Vector2();
  private talk(p: Person) {
    const lines = LINES[p.role], text = lines[(p.seed + p.line++) % lines.length];
    p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y);
    p.wait = Math.max(p.wait, 4);
    this.say(p, text);
    this.speak();
  }
  private say(p: Person, text: string) {
    if (p.bubble) { p.av.root.remove(p.bubble); (p.bubble.material as THREE.SpriteMaterial).map?.dispose(); (p.bubble.material as THREE.SpriteMaterial).dispose(); }
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const g = c.getContext("2d")!;
    g.font = `600 34px Pretendard, "Noto Sans KR", sans-serif`;
    const w = Math.min(500, g.measureText(text).width + 48);
    g.fillStyle = "rgba(255,255,255,0.94)"; g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 86, 26); g.fill();
    g.beginPath(); g.moveTo(240, 94); g.lineTo(256, 118); g.lineTo(272, 94); g.fill();
    g.fillStyle = "#1d2126"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 54, 470);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(1.6, 0.4, 1); s.position.y = p.pose === "sit" ? 1.6 : 2.15; s.renderOrder = 10;
    p.av.root.add(s); p.bubble = s; p.bubbleT = 4.5;
  }

  update(dt: number, visitor: { x: number; z: number }) {
    this.visitor.set(visitor.x, visitor.z);
    for (const p of this.people) {
      if (p.bubble && (p.bubbleT -= dt) <= 0) { p.av.root.remove(p.bubble); (p.bubble.material as THREE.SpriteMaterial).map?.dispose(); (p.bubble.material as THREE.SpriteMaterial).dispose(); p.bubble = null; p.turnTo = null; }
      let speed = 0;
      if (!p.spot) {
        // a walker: to a door, a pause there, on to another
        if (p.wait > 0) p.wait -= dt;
        else if (!p.path.length) this.plot(p);
        else {
          const to = p.path[0], dx = to.x - p.pos.x, dz = to.y - p.pos.y, d = Math.hypot(dx, dz);
          // (the visitor in the way ahead: stop and wait)
          const vx = visitor.x - p.pos.x, vz = visitor.z - p.pos.y, vd = Math.hypot(vx, vz);
          const blocked = vd < 1.1 && (vx * dx + vz * dz) / Math.max(1e-6, vd * d) > 0.3;
          if (d < 0.08) { p.path.shift(); if (!p.path.length) p.wait = 2 + (p.seed % 5); }
          else if (!blocked) {
            const step = Math.min(d, p.speed * dt);
            p.pos.x += (dx / d) * step; p.pos.y += (dz / d) * step; speed = p.speed;
            const want = Math.atan2(dx, dz); p.face += angle(want - p.face) * Math.min(1, dt * 8);
          }
        }
      }
      if (p.turnTo !== null) p.face += angle(p.turnTo - p.face) * Math.min(1, dt * 6);
      p.av.update(dt, speed);
      this.place(p, dt);
    }
  }
  private plot(p: Person) {
    if (!this.nodes.length) return;
    const n = this.nodes[(p.seed + Math.floor(performance.now() / 1000)) % this.nodes.length];
    // (down the corridor's middle line, then across to the door)
    const cy = this.corridorY, cr = this.corridor?.rect;
    const along = cr && cr[2] - cr[0] >= cr[3] - cr[1];
    p.path = along ? [new THREE.Vector2(p.pos.x, cy), new THREE.Vector2(n.p.x, cy), n.p.clone()] : [new THREE.Vector2((cr![0] + cr![2]) / 2, p.pos.y), new THREE.Vector2((cr![0] + cr![2]) / 2, n.p.y), n.p.clone()];
    p.seed += 7;
  }
  private place(p: Person, _dt: number) {
    const r = p.av.root;
    if (p.pose === "lie") {
      // on the back in the bed: the head at the spot, the feet the way it faces
      const fx = Math.sin(p.face), fz = Math.cos(p.face);
      r.rotation.set(-Math.PI / 2, p.face, 0, "YXZ");
      r.position.set(p.pos.x + fx * 1.62 - fx * 0.02, p.y + 0.02, p.pos.y + fz * 1.62);
      // (lying: the avatar's own "lie" pose)
      p.av.pose = "lie";
      return;
    }
    r.rotation.set(0, p.face, 0, "YXZ");
    // (seated: a little back on the seat)
    const back = p.pose === "sit" ? -0.05 : 0;
    r.position.set(p.pos.x + Math.sin(p.face) * back, p.y, p.pos.y + Math.cos(p.face) * back);
  }
  dispose() {
    for (const p of this.people) { if (p.bubble) { (p.bubble.material as THREE.SpriteMaterial).map?.dispose(); (p.bubble.material as THREE.SpriteMaterial).dispose(); } p.av.dispose(); }
    this.bubbleTex.forEach(t => t.dispose());
  }
}
const angle = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
