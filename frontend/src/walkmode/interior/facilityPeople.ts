import * as THREE from "three";
import { Avatar } from "../player/avatar";
import { IDLE_BY_ROLE, GESTURES, type GestureName } from "../player/gestures";
import type { Spot } from "./facilityFurnish";
import type { Interactable } from "./furnish";
import type { FacilityRole, FloorPlan, Opening, Room } from "./plan/types";
import { talk } from "./npcTalk";
import { affinityWord, runWarning, socialAnswer, type Social, type SocialAnswer } from "./npcLines";

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
  /** when they last greeted the visitor going by, or said sorry for being in the way (s) */
  greeted: number; bumped: number;
  /** how much they like the visitor (0…100), the last social action and how many times running */
  rel: number; last: Social | null; again: number;
  /** when they next do something of their own accord (a stretch, a look at the phone) */
  idleAt: number;
  /** their own line down the corridor (−1 … 1 of its clear half-width), the place they are making
   * for (claimed: no two head for the same one), how they last moved (for the others to read) */
  lane: number; goal: number; dir: THREE.Vector2; moving: number; detourAt: number; stuck: number;
}
/** what a talk gives the page: who answered, what they said, and their part (for the questions) */
export interface PersonTalk { id: number; name: string; role: FacilityRole; text: string; /** the room they are in (its label) */ room: string; /** liking for the visitor, and in words */ rel: number; relWord: string }
/** short words for passing by: staff greet, the rest excuse themselves when in the way */
const GREET_STAFF = ["안녕하세요!", "어서 오세요.", "안녕하세요, 도와드릴까요?", "네, 안녕하세요.", "편하게 둘러보세요."];
const GREET_PEER = ["아, 안녕하세요.", "(가볍게 목례)", "안녕하세요~"];
const EXCUSE = ["앗, 죄송합니다.", "잠시만 지나갈게요.", "실례합니다.", "어이쿠, 먼저 가세요."];

export class People {
  readonly root = new THREE.Group();
  private people: Person[] = [];
  private bubbleTex: THREE.CanvasTexture[] = [];
  /** points on the corridor and the halls the walkers go between */
  private nodes: { p: THREE.Vector2; room: string }[] = [];
  private corridorY: number; private corridor: Room | undefined;
  private walkers = 0;
  /** where a walker may stand: the public rooms (corridor, lobby, halls) — not pushed into a wall */
  private walkable: [number, number, number, number][] = [];

  /** the page's dialogue for a talk (absent: the bubble only) */
  onTalk: ((t: PersonTalk) => void) | null = null;
  private clock = 0;
  /** `speak(text, pitch)`: a voice for what is said (the walk's babble), pitch by the person */
  constructor(private plan: FloorPlan, spots: Spot[], private speak: (text: string, pitch: number) => void, private hour = 12) {
    const fac = plan.facility!, used = new Set<Spot>();
    let seed = Math.abs([...`${plan.complexId}|${fac.level}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    // (the walkers keep to the floor's main corridor or hall: its biggest)
    const ar = (r: Room) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
    this.corridor = plan.rooms.filter(r => r.type === "corridor" || r.type === "lobby").sort((a, b) => ar(b) - ar(a))[0];
    const cid = this.corridor?.id ?? "";
    const cr = this.corridor?.rect ?? plan.bounds; this.corridorY = (cr[1] + cr[3]) / 2;
    this.walkable = plan.rooms.filter(r => ["corridor", "lobby", "liftHall", "waiting", "gallery", "shop", "service", "cafe"].includes(r.type)).map(r => [r.rect[0] + 0.32, r.rect[1] + 0.32, r.rect[2] - 0.32, r.rect[3] - 0.32] as [number, number, number, number]).filter(r => r[2] > r[0] && r[3] > r[1]);
    // the doors off the corridor: just outside each, a place walkers go to
    for (const o of plan.openings) {
      if (o.type === "window" || (o.a !== cid && o.b !== cid)) continue;
      const other = o.a === cid ? o.b : o.a;
      if (other === "out") continue;
      this.nodes.push({ p: this.doorPoint(o), room: other });
    }
    const atSpot = new Map<string, Spot[]>();
    for (const s of spots) { const l = atSpot.get(s.room.id) ?? []; l.push(s); atSpot.set(s.room.id, l); }
    // (a busy floor but not a crowd: ~12 at most, the rest of the parts left out; a large floor —
    // a hospital's — more, those nearest the way in first: far ones are not drawn — update)
    const B = plan.bounds; this.large = Math.max(B[2] - B[0], B[3] - B[1]) > 48;
    const cap = this.large ? 36 : 12;
    const st = fac.start, roomById = new Map(plan.rooms.map(r => [r.id, r]));
    const dist = (id: string) => { const r = roomById.get(id); return r ? Math.hypot((r.rect[0] + r.rect[2]) / 2 - st[0], (r.rect[1] + r.rect[3]) / 2 - st[1]) : Infinity; };
    const order = this.large ? fac.people.slice().sort((a, b) => dist(a.room) - dist(b.room)) : fac.people;
    for (const want of order) {
      if (this.people.length >= cap) break;
      const room = plan.rooms.find(r => r.id === want.room); if (!room) continue;
      const free = (atSpot.get(room.id) ?? []).filter(s => !used.has(s));
      const s = PLACES[want.role].map(k => free.find(f => f.kind === k)).find(Boolean);
      const walker = !s && (room.type === "corridor" || room.type === "lobby" || room.type === "liftHall" || room.type === "waiting" || room.type === "gallery" || room.type === "shop" || room.type === "parking");
      if (!s && !walker) continue;
      if (s) used.add(s);
      const av = new Avatar(1 + Math.floor(rnd() * 9999), { ...OUTFIT[want.role], role: want.role });
      av.shoes(true);
      const p: Person = { av, role: want.role, room, spot: s, pos: new THREE.Vector2(s?.x ?? 0, s?.z ?? 0), face: s?.face ?? 0, pose: s?.pose ?? "stand", y: s?.y ?? 0,
        path: [], wait: rnd() * 4, speed: 1.05 + rnd() * 0.35, bubble: null, bubbleT: 0, turnTo: null, seed: Math.floor(rnd() * 1000), line: 0, greeted: -99, bumped: -99, rel: 12 + Math.floor(rnd() * 14), last: null, again: 0, idleAt: 4 + rnd() * 14,
        lane: 0, goal: -1, dir: new THREE.Vector2(), moving: 0, detourAt: -9, stuck: 0 };
      if (walker) {
        // (each walker starts at a place of its own — the least used — spread along the corridor at its own lane)
        if (!this.nodes.length) continue;
        const k = this.walkers++, lane = ((k * 0.618034) % 1) * 2 - 1;
        const counts = this.nodes.map((_, i) => this.people.filter(q => !q.spot && q.goal === i).length);
        const min = Math.min(...counts), free = this.nodes.map((_, i) => i).filter(i => counts[i] === min);
        const i = free[Math.floor(rnd() * free.length)], n = this.nodes[i];
        p.goal = i; p.lane = lane; p.pos.copy(this.onLane(n.p, lane)); p.pose = "stand"; p.spot = undefined; p.wait = 1 + rnd() * 6;
      }
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
  private large = false;
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
  /** their voice's pitch: low to high by who they are */
  private pitch(p: Person) { return 0.78 + ((p.seed * 37) % 100) / 100 * 0.6; }
  private talk(p: Person) {
    // (their own words, put together for them, going on from what they said before — npcTalk.ts;
    // the few stock lines only for a plan without its building)
    const text = this.plan.facility ? talk({ role: p.role, kind: this.plan.facility.kind, plan: this.plan, room: p.room.label, seed: p.seed * 31 + this.people.indexOf(p), turn: p.line++, hour: this.hour })
      : LINES[p.role][(p.seed + p.line++) % LINES[p.role].length];
    p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y);
    p.wait = Math.max(p.wait, 8);
    this.say(p, text);
    this.speak(text, this.pitch(p));
    p.av.play(/층|쪽|복도|끝|엘리베이터|계단|오른|왼|앞/.test(text) ? "point" : /글쎄|모르|음…|고민/.test(text) ? "think" : /하하|ㅎㅎ|재밌|웃/.test(text) ? "laugh" : (["nod", "nod", "shrug", "think", "beckon"] as GestureName[])[(p.seed + p.line) % 5]);
    this.onTalk?.({ id: this.people.indexOf(p), name: this.title(p), role: p.role, text, room: p.room.label, rel: p.rel, relWord: affinityWord(p.rel) });
  }
  /** A social action (the Sims-like part): their answer from npcLines, their liking changed by it,
   * said aloud with a mark of how it went over the head (♥ glad, … awkward, 💢 annoyed). */
  social(id: number, a: Social, places: string[], gift?: string): (SocialAnswer & { rel: number; relWord: string }) | null {
    const p = this.people[id], f = this.plan.facility; if (!p || !f) return null;
    p.again = p.last === a ? p.again + 1 : 0; p.last = a;
    let s = (p.seed * 2654435761 + p.line++ * 40503 + a.length * 97) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const ans = socialAnswer(a, { role: p.role, kind: f.kind, bldg: f.name, floor: f.levelLabel, places, affinity: p.rel, rnd, gift }, p.again);
    p.rel = Math.max(0, Math.min(100, p.rel + ans.delta));
    const mark = ans.mood === "happy" ? "♥ " : ans.mood === "annoyed" ? "💢 " : ans.mood === "awkward" ? "… " : "";
    p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y); p.wait = Math.max(p.wait, 8);
    this.say(p, mark + ans.text); this.speak(ans.text, this.pitch(p));
    const pick = (l: GestureName[]) => l[(p.seed + p.line) % l.length];
    p.av.play(ans.mood === "happy" ? pick(a === "joke" ? ["laugh", "laugh", "clap"] : a === "compliment" ? ["shy", "heart", "thumbsUp"] : a === "gift" ? ["cheer", "jump", "heart"] : a === "greet" ? ["wave", "bow"] : a === "tip" ? ["point", "thumbsUp"] : ["nod", "thumbsUp", "clap"])
      : ans.mood === "annoyed" ? pick(["facepalm", "angry", "crossArms", "shake"]) : ans.mood === "awkward" ? pick(["scratch", "shrug", "shy"]) : pick(["nod", "think", "shrug"]));
    return { ...ans, rel: p.rel, relWord: affinityWord(p.rel) };
  }
  /** the page's "다른 얘기" (or a question's answer): the same person goes on */
  talkAgain(id: number) { const p = this.people[id]; if (p) this.talk(p); }
  /** a reply put in their mouth (an answer to a question the page asked) */
  reply(id: number, text: string) {
    const p = this.people[id]; if (!p) return;
    p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y); p.wait = Math.max(p.wait, 6);
    this.say(p, text); this.speak(text, this.pitch(p));
  }
  /** a word in passing (a greeting, sorry), without the page's dialogue */
  private remark(p: Person, text: string) {
    p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y);
    this.say(p, text); this.speak(text, this.pitch(p));
  }
  private say(p: Person, text: string) {
    if (p.bubble) { p.av.root.remove(p.bubble); (p.bubble.material as THREE.SpriteMaterial).map?.dispose(); (p.bubble.material as THREE.SpriteMaterial).dispose(); }
    // (a longer answer wrapped over up to four lines, word by word)
    const W = 768, font = `600 34px Pretendard, "Noto Sans KR", sans-serif`, meas = document.createElement("canvas").getContext("2d")!;
    meas.font = font;
    const lines: string[] = []; let cur = "";
    for (const word of text.split(" ")) { const t = cur ? `${cur} ${word}` : word; if (meas.measureText(t).width > W - 80 && cur) { lines.push(cur); cur = word; } else cur = t; }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 4), LH = 44, H = shown.length * LH + 70;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d")!; g.font = font;
    const w = Math.min(W - 12, Math.max(...shown.map(l => g.measureText(l).width)) + 56);
    g.fillStyle = "rgba(255,255,255,0.95)"; g.beginPath(); g.roundRect((W - w) / 2, 8, w, H - 40, 26); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 16, H - 33); g.lineTo(W / 2, H - 8); g.lineTo(W / 2 + 16, H - 33); g.fill();
    g.fillStyle = "#1d2126"; g.textAlign = "center"; g.textBaseline = "middle";
    shown.forEach((l, i) => g.fillText(l, W / 2, 8 + 22 + i * LH + 6, W - 70));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(2.2, 2.2 * H / W, 1); s.center.set(0.5, 0); s.position.y = p.pose === "sit" ? 1.45 : 1.95; s.renderOrder = 10;
    p.av.root.add(s); p.bubble = s; p.bubbleT = 3 + text.length * 0.09;
  }

  /** The visitor's gesture seen by those near: answered in kind — a wave back, a bow for a bow,
   * clapping (or joining in) for a dance, a cheer for a cheer, a shy look for a heart. */
  react(g: GestureName) {
    const near = this.people.filter(p => p.pose !== "lie" && Math.hypot(p.pos.x - this.visitor.x, p.pos.y - this.visitor.y) < 5.5)
      .sort((a, b) => Math.hypot(a.pos.x - this.visitor.x, a.pos.y - this.visitor.y) - Math.hypot(b.pos.x - this.visitor.x, b.pos.y - this.visitor.y)).slice(0, 5);
    const said: Partial<Record<GestureName, string[]>> = { wave: ["안녕하세요~", "반가워요!"], bow: ["안녕하세요.", "네, 반갑습니다."], dance: ["오~ 춤 잘 추시네요!", "같이 춰요!"], robot: ["로봇 춤이다!", "와 멋있다!"], groove: ["리듬 좋네요~"], cheer: ["와아!", "만세!"], heart: ["어머, 감사해요!", "(부끄)"], clap: ["감사합니다!"], angry: ["저, 괜찮으세요?", "진정하세요…"], thumbsUp: ["최고!"], jump: ["기분 좋은 일 있으세요?"], cry: ["괜찮아요? 무슨 일 있어요?"], kick: ["깜짝이야!"], salute: ["충성!"], peace: ["찰칵~ 브이!"] };
    near.forEach((p, i) => {
      const r: GestureName = g === "wave" ? "wave" : g === "bow" || g === "deepBow" ? "bow" : g === "dance" || g === "robot" || g === "groove" ? (p.role === "student" || p.seed % 3 === 0 ? g : i % 2 ? "clap" : "cheer")
        : g === "cheer" || g === "jump" ? (i % 2 ? "cheer" : "clap") : g === "heart" ? (p.seed % 2 ? "shy" : "heart") : g === "angry" || g === "facepalm" ? "shrug" : g === "thumbsUp" ? "thumbsUp" : g === "salute" ? "salute"
        : g === "cry" ? "beckon" : g === "kick" ? "stop" : g === "peace" ? "peace" : g === "laugh" ? "laugh" : g === "clap" ? "bow" : "nod";
      if (p.pose === "sit" && GESTURES[r].legs) return;
      p.turnTo = Math.atan2(this.visitor.x - p.pos.x, this.visitor.y - p.pos.y); p.wait = Math.max(p.wait, 4);
      setTimeout(() => p.av.play(r), 200 + i * 260);
      const l = said[g]; if (i === 0 && l && !p.bubble) this.remark(p, l[(p.seed + p.line++) % l.length]);
    });
  }
  private runWarnAt = -99;
  update(dt: number, visitor: { x: number; z: number; speed?: number }) {
    this.visitor.set(visitor.x, visitor.z); this.clock += dt;
    let spoke = false;
    // (running in a hospital: the nearest of its staff says so, now and then)
    const fk = this.plan.facility?.kind;
    if ((fk === "clinic" || fk === "ward") && (visitor.speed ?? 0) > 2.6 && this.clock - this.runWarnAt > 9) {
      const near = this.people.filter(p => (p.role === "nurse" || p.role === "doctor" || p.role === "guard" || p.role === "clerk") && p.pose !== "lie" && Math.hypot(p.pos.x - visitor.x, p.pos.y - visitor.z) < 5)
        .sort((a, b) => Math.hypot(a.pos.x - visitor.x, a.pos.y - visitor.z) - Math.hypot(b.pos.x - visitor.x, b.pos.y - visitor.z))[0];
      if (near) { this.runWarnAt = this.clock; spoke = true; let s = Math.floor(this.clock * 1000) >>> 0; this.remark(near, runWarning(() => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; })); near.av.play("stop"); }
    }
    for (const p of this.people) {
      // (the visitor coming up to staff at their place: a greeting, once in a while; at most one a frame)
      const vd = Math.hypot(visitor.x - p.pos.x, visitor.z - p.pos.y);
      if (!spoke && !p.bubble && p.pose !== "lie" && vd < 1.9 && vd > 0.5 && this.clock - p.greeted > 45 && this.clock > 2) {
        p.greeted = this.clock;
        const staff = p.role === "clerk" || p.role === "nurse" || p.role === "guard" || p.role === "desk" || p.role === "doctor" || p.role === "cook";
        if (staff || (p.seed % 3 === 0)) { this.remark(p, (staff ? GREET_STAFF : GREET_PEER)[(p.seed + Math.floor(this.clock)) % (staff ? GREET_STAFF : GREET_PEER).length]); spoke = true; p.av.play(p.role === "guard" ? "salute" : staff ? (p.seed % 2 ? "bow" : "wave") : "wave"); }
      }
      // (a large floor's people far off: not drawn, not walked — they wait where they are)
      if (this.large) { const far = Math.hypot(p.pos.x - visitor.x, p.pos.y - visitor.z) > 42; p.av.root.visible = !far; if (far) continue; }
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
          // (held up by the visitor: sorry, and round them — a step to the side of the way ahead)
          if (blocked && !spoke && this.clock - p.bumped > 20 && vd < 0.8) {
            p.bumped = this.clock; spoke = true; this.remark(p, EXCUSE[(p.seed + p.line) % EXCUSE.length]); p.av.play(p.seed % 2 ? "bow" : "stop");
            const side = (vx * dz - vz * dx) > 0 ? -1 : 1, ox = -dz / d * 0.7 * side, oz = dx / d * 0.7 * side;
            p.path.unshift(new THREE.Vector2(p.pos.x + ox + dx / d * 0.4, p.pos.y + oz + dz / d * 0.4));
          }
          if (d < 0.12) { p.path.shift(); if (!p.path.length) p.wait = 2 + ((p.seed + Math.floor(this.clock)) % 6); }
          else if (!blocked || this.clock - p.bumped < 1.5) {
            const ux = dx / d, uz = dz / d;
            // (another person ahead: behind one going the same way, keep pace; meeting one, both
            // bear right; one standing there, round them on the roomier side)
            let pace = p.speed;
            const o = this.aheadOf(p, ux, uz, 1.5);
            if (o && this.clock - p.detourAt > 0.8) {
              const rightX = -uz, rightZ = ux;
              if (o.oncoming || o.q.moving < 0.2) {
                const sideSign = o.oncoming ? 1 : (o.side > 0 ? -1 : 1), off = 0.62 - Math.abs(o.side) * 0.5;
                const wx = o.q.pos.x + rightX * sideSign * off + ux * 0.25, wz = o.q.pos.y + rightZ * sideSign * off + uz * 0.25;
                if (this.inWalkable(wx, wz)) { p.path.unshift(new THREE.Vector2(wx, wz)); p.detourAt = this.clock; }
                else pace = 0;
              } else if (o.along < 1.0) pace = Math.min(pace, o.q.moving * 0.95);
            }
            if (o && o.along < 0.55 && !o.oncoming && o.q.moving < 0.2) pace = 0;
            // (held up too long: give up the place and go somewhere else)
            p.stuck = pace < 0.05 ? p.stuck + dt : 0;
            if (p.stuck > 3) { p.stuck = 0; p.path = []; p.wait = 0.5; }
            const step = Math.min(d, pace * dt);
            p.pos.x += ux * step; p.pos.y += uz * step; speed = pace;
            if (step > 0) { p.dir.set(ux, uz); const want = Math.atan2(dx, dz); p.face += angle(want - p.face) * Math.min(1, dt * 8); }
          }
        }
      }
      if (p.turnTo !== null && p.pose === "stand") p.face += angle(p.turnTo - p.face) * Math.min(1, dt * 6);
      // (nothing to do for a while — waiting, at their post, seated: a gesture of their own, by their job)
      if (speed === 0 && p.pose !== "lie" && !p.bubble && !p.av.playing && this.clock > p.idleAt) {
        const l = IDLE_BY_ROLE[p.role] ?? IDLE_BY_ROLE.visitor, g = l[(p.seed + Math.floor(this.clock)) % l.length];
        if (p.pose === "stand" || !GESTURES[g].legs) p.av.play(g);
        p.idleAt = this.clock + 8 + ((p.seed * 13 + Math.floor(this.clock)) % 17);
      }
      p.moving = speed;
      p.av.update(dt, speed);
      if (p.turnTo !== null && p.pose === "sit") p.av.lookSide(angle(p.turnTo - p.face));
    }
    this.separate();
    for (const p of this.people) this.place(p, dt);
  }
  /** a point moved across the corridor to a lane (−1 … 1 of its clear half-width) */
  private onLane(q: THREE.Vector2, lane: number): THREE.Vector2 {
    const cr = this.corridor?.rect; if (!cr) return q.clone();
    const along = cr[2] - cr[0] >= cr[3] - cr[1], half = Math.max(0, (along ? cr[3] - cr[1] : cr[2] - cr[0]) / 2 - 0.45);
    return along ? new THREE.Vector2(q.x, this.corridorY + lane * half) : new THREE.Vector2((cr[0] + cr[2]) / 2 + lane * half, q.y);
  }
  private plot(p: Person) {
    if (!this.nodes.length) return;
    // (somewhere no one else is making for — of a few picked at random, the one fewest others are near,
    // never the one just left; then the lane wanders a little, so a route is never quite repeated)
    let h = (p.seed * 2654435761 + Math.floor(this.clock * 10) * 40503) >>> 0;
    const r = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
    const claimed = new Set(this.people.filter(q => q !== p && !q.spot).map(q => q.goal));
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(r() * this.nodes.length); if (i === p.goal && this.nodes.length > 1) continue;
      const n = this.nodes[i].p, crowd = this.people.filter(q => q !== p && q.pos.distanceTo(n) < 1.6).length;
      const score = (claimed.has(i) ? -10 : 0) - crowd * 3 + Math.min(12, n.distanceTo(p.pos)) * 0.3 + r();
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = (p.goal + 1) % this.nodes.length;
    p.goal = best;
    p.lane = THREE.MathUtils.clamp(p.lane + (r() - 0.5) * 0.5, -1, 1);
    const n = this.nodes[best].p, cr = this.corridor?.rect;
    const along = !!cr && cr[2] - cr[0] >= cr[3] - cr[1];
    // (the door's spot itself a little off its middle, by the walker: two arriving do not meet on it)
    const off = (r() - 0.5) * 0.7, end = along ? new THREE.Vector2(n.x + off, n.y) : new THREE.Vector2(n.x, n.y + off);
    const a = this.onLane(p.pos, p.lane), b = this.onLane(end, p.lane);
    p.path = cr ? [a, b, end] : [end];
    p.seed += 7;
  }
  private inWalkable(x: number, z: number) { return !this.walkable.length || this.walkable.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]); }
  /** Everyone keeps their own room: walkers pushed apart from each other and off those standing or
   * seated (who stay put), never into a wall. */
  private separate() {
    const P = this.people;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j]; if (a.pose === "lie" || b.pose === "lie") continue;
      const ma = a.spot ? 0 : 1, mb = b.spot ? 0 : 1; if (!ma && !mb) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.y - a.pos.y, d = Math.hypot(dx, dz), min = a.pose === "sit" || b.pose === "sit" ? 0.5 : 0.62;
      if (d >= min) continue;
      // (exactly together: apart along a fixed side, by who is who)
      const nx = d > 1e-4 ? dx / d : Math.cos(i * 2.4), nz = d > 1e-4 ? dz / d : Math.sin(i * 2.4), o = (min - d) / (ma + mb);
      const ax = a.pos.x - nx * o * ma, az = a.pos.y - nz * o * ma, bx = b.pos.x + nx * o * mb, bz = b.pos.y + nz * o * mb;
      if (ma && this.inWalkable(ax, az)) a.pos.set(ax, az);
      if (mb && this.inWalkable(bx, bz)) b.pos.set(bx, bz);
    }
  }
  /** Who is in the way ahead within `reach` m along `dir`: the nearest, how far, how far to one side, and whether they come the other way. */
  private aheadOf(p: Person, dx: number, dz: number, reach: number) {
    let hit: { q: Person; along: number; side: number; oncoming: boolean } | null = null;
    for (const q of this.people) {
      if (q === p || q.pose === "lie") continue;
      const rx = q.pos.x - p.pos.x, rz = q.pos.y - p.pos.y, along = rx * dx + rz * dz, side = rx * -dz + rz * dx;
      if (along <= 0.05 || along > reach || Math.abs(side) > 0.55) continue;
      if (!hit || along < hit.along) hit = { q, along, side, oncoming: q.moving > 0.2 && q.dir.x * dx + q.dir.y * dz < -0.3 };
    }
    return hit;
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
