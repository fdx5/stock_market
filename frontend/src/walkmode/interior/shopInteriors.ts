import * as THREE from "three";
import type { Frame } from "./furnish";
import type { Palette } from "./materials";
import type { Extra } from "./facilityModels";
import * as F from "./facilityModels";
import * as M from "./models";
import type { Spot } from "./facilityFurnish";
import type { SideName } from "./furnish";
import { hangingGarment, mannequin, shelfRow, stockFor, tableTop } from "./productDisplay";
import type { Cat } from "./catalog";
import { storeOfName } from "./shop";

/* A business's own interior, from what it is: its name and category from the building's places
 * (the survey's companies, the map's shops) read as a kind — a convenience store, a cosmetics shop,
 * a clothes shop, a bank, a bookshop, a bakery, a restaurant, a hair salon, a phone or electronics
 * shop, an optician, a PC방, a gym, a variety store — each laid out as such and in its brand's
 * colour where the name is known. Everything in code at real sizes, the same kit as the rest. */

export type ShopStyle = "convenience" | "cosmetics" | "clothing" | "bank" | "books" | "bakery" | "restaurant" | "salon" | "electronics" | "eyewear" | "pcroom" | "gym" | "variety" | "general";
const RULES: [ShopStyle, RegExp][] = [
  ["convenience", /편의점|GS25|지에스25|CU\b|씨유|세븐일레븐|이마트24|미니스톱|마트/i],
  ["cosmetics", /올리브영|화장품|코스메틱|아리따움|이니스프리|에뛰드|더페이스샵|미샤|토니모리|시코르|세포라|랄라블라|롭스/i],
  ["clothing", /유니클로|자라|ZARA|H&M|탑텐|스파오|에잇세컨즈|무신사|의류|패션|옷|아울렛|양복|부티크|캐주얼|신발|ABC마트|나이키|아디다스|뉴발란스/i],
  ["bank", /은행|국민|신한|우리은행|하나은행|농협|NH|기업은행|IBK|새마을금고|신협|우체국|증권|저축은행|카카오뱅크/i],
  ["books", /서점|문고|교보|영풍|알라딘|예스24|북스|책방|도서/i],
  ["bakery", /파리바게|뚜레쥬르|베이커리|제과|빵|브레드|도넛|던킨|크리스피/i],
  ["restaurant", /식당|한식|중식|일식|양식|분식|국밥|치킨|피자|버거|맥도날드|롯데리아|KFC|맘스터치|서브웨이|초밥|스시|라멘|우동|냉면|칼국수|김밥|떡볶이|고기|갈비|삼겹|족발|보쌈|쌀국수|음식점|푸드|뷔페|레스토랑/i],
  ["salon", /헤어|미용|살롱|바버|네일|뷰티|준오|박승철|이철|블루클럽/i],
  ["electronics", /하이마트|전자|삼성디지털|LG베스트|애플|휴대폰|핸드폰|폰|SKT|KT플라자|LG U\+|유플러스|텔레콤|모바일|컴퓨터|노트북|카메라/i],
  ["eyewear", /안경|렌즈|옵티컬|글라스|다비치|으뜸50/i],
  ["pcroom", /PC방|피씨방|게임|오락실|e스포츠/i],
  ["gym", /헬스|피트니스|짐\b|GYM|필라테스|요가|크로스핏|체육관|복싱|태권도/i],
  ["variety", /다이소|생활용품|잡화|문구|아트박스|버터|모던하우스|자주/i],
];
/** brand colours where the name is known (a sign's and a feature wall's) */
const BRAND: [RegExp, string][] = [
  [/CU\b|씨유/i, "#6d2077"], [/GS25|지에스/i, "#0a7bd5"], [/세븐일레븐/i, "#00824a"], [/이마트24/i, "#ffb81c"], [/올리브영/i, "#9bc53d"],
  [/스타벅스/i, "#00704a"], [/파리바게/i, "#00205b"], [/뚜레쥬르/i, "#00704a"], [/국민/i, "#ffbc00"], [/신한/i, "#0046ff"], [/우리은행/i, "#0067ac"],
  [/하나은행/i, "#008485"], [/농협|NH/i, "#00a651"], [/기업은행|IBK/i, "#1f4e9c"], [/다이소/i, "#e60012"], [/유니클로/i, "#e60012"], [/교보/i, "#00703c"],
  [/맥도날드/i, "#da291c"], [/롯데리아/i, "#e3001b"], [/하이마트/i, "#e60012"], [/SKT|텔레콤/i, "#ea002c"], [/KT/i, "#000000"], [/유플러스|U\+/i, "#e6007e"],
  [/아리따움/i, "#c8a96b"], [/이니스프리/i, "#0b7b46"], [/나이키/i, "#111111"], [/아디다스/i, "#111111"],
];
export function shopStyle(text: string): ShopStyle { if (/ABC마트|슈마커|레스모아|슈즈|신발/i.test(text)) return "clothing"; for (const [s, re] of RULES) if (re.test(text)) return s; return "general"; }
export function brandColour(text: string, style: ShopStyle): string {
  for (const [re, c] of BRAND) if (re.test(text)) return c;
  return ({ convenience: "#2a7de1", cosmetics: "#e8a0b4", clothing: "#2b2b2b", bank: "#1f4e9c", books: "#7a5a3a", bakery: "#c8873a", restaurant: "#b8452f", salon: "#3a3a3a", electronics: "#1a73e8", eyewear: "#4a6a8a", pcroom: "#7b2cbf", gym: "#e63946", variety: "#e60012", general: "#5ef0ff" } as Record<ShopStyle, string>)[style];
}

/** the helpers of furnishFacilityRoom a styled shop needs */
export interface ShopKit {
  P: Palette; X: Extra; H: number; zone: number; name: string; /** the floor's level in the room */ fy: number;
  X0: number; Z0: number; X1: number; Z1: number; cx: number; cz: number; W: number; D: number;
  doorSide: SideName; backSide: SideName; sideW: SideName[];
  put(kit: M.Kit, f: Frame | THREE.Matrix4, solid?: boolean): void;
  wallPut(s: SideName, kit: M.Kit, w: number, d: number, prefer?: number | null, height?: number): Frame | null;
  freeAt(x: number, z: number, w: number, d: number, yaw?: number, take?: boolean): Frame | null;
  wallLen(s: SideName): number;
  spot(p: THREE.Vector3, face: number, pose: Spot["pose"], kind: Spot["kind"]): void;
  seat(label: string, p: THREE.Vector3, face: number): void;
  sign(s: SideName, lines: string[], w: number, h: number, y: number): void;
  material(colour: string, opts?: THREE.MeshStandardMaterialParameters): THREE.Material;
  plant(): void;
  /** a fitting made usable: its look box (in the frame: w × h × d at x, y, z), what it says, what it does */
  use(f: Frame, box: [number, number, number, number, number, number], label: string, act: () => void): void;
  /** the building's hooks: a shop's menu, something had at once, a word on the screen, a sound */
  shop(kind: import("./shop").ShopKind): void;
  consume(item: import("./shop").Consumable): void;
  toast(text: string): void;
  /** the bookshop's shelf of readable books opened (BookReader) */
  read?(): void;
  fx(name: "scan" | "coffee" | "water" | "atm" | "copier" | "pages" | "keys" | "treadmill" | "pick" | "chime" | "register"): void;
  at(f: Frame, x: number, y: number, z: number): THREE.Vector3;
  yawOf(f: Frame): number;
}

/** furnish a shop by its kind; false when its kind has no layout of its own (the general shop then) */
export function furnishStyledShop(k: ShopKit, style: ShopStyle): boolean {
  // (a large food store — 이마트, 홈플러스, a 하나로마트, any 마트 over 120 m² — is a supermarket)
  if ((style === "convenience" && (k.W * k.D > 120 || /이마트(?!24)|홈플러스|롯데마트|하나로|코스트코|트레이더스|킴스클럽|대형마트|슈퍼마켓/.test(k.name))) || /이마트(?!24)|홈플러스|롯데마트|하나로마트|코스트코|트레이더스/.test(k.name)) return mart(k);
  if (style === "general" || style === "convenience") return false;
  const { P, X } = k, brand = k.material(brandColour(k.name, style)), lit = k.material("#fff4dc", { emissive: "#fff1d0", emissiveIntensity: 0.7 });
  const ALL: SideName[] = ["n", "s", "w", "e"];
  /** a wall piece made to a length: tried on the preferred walls, then on any wall but the way in, at
   * its full length, then shorter, then needing less clear wall above (under a window) */
  const onWall = (prefer: SideName[], max: number, d: number, height: number, make: (len: number) => M.Kit, min = 1): { f: Frame; len: number; s: SideName } | null => {
    const order = [...prefer, ...ALL.filter(x => x !== k.doorSide)].filter((x, i, a) => a.indexOf(x) === i);
    for (const h of [height, Math.min(height, 1.0)]) for (const s of order) for (const kf of [1, 0.7, 0.45]) {
      const len = Math.min(max, k.wallLen(s) - 1.0) * kf; if (len < min) continue;
      const f = k.wallPut(s, make(len), len, d, null, h); if (f) return { f, len, s };
    }
    return null;
  };
  /** every wall but the way in lined with a piece (as long as each allows) */
  const lineWalls = (max: number, d: number, height: number, make: (len: number, s: SideName) => M.Kit, onRun?: (f: Frame, len: number, d: number) => void) => {
    let n = 0;
    // (a long wall takes as many runs as fit, side by side)
    for (const s of ALL.filter(x => x !== k.doorSide)) {
      const len = Math.min(max, k.wallLen(s) - 1.2); if (len < 1) continue;
      const runs = Math.max(1, Math.min(6, Math.floor((k.wallLen(s) - 1.2) / (len + 0.4))));
      for (let r = 0; r < runs; r++) { let ok = false; for (const h of [height, 1.0]) { const f = k.wallPut(s, make(len, s), len, d, null, h); if (f) { ok = true; n++; onRun?.(f, len, d); break; } } if (!ok) break; }
    }
    return n;
  };
  // (the kind's own floor: polished white, warm wood, stone, rubber… laid over the building's)
  const FLOOR: Partial<Record<ShopStyle, [string, number, number]>> = { cosmetics: ["#f4f2ef", 0.18, 0.1], clothing: ["#cbbba6", 0.5, 0], bank: ["#d8cfc0", 0.3, 0.05], books: ["#9a7650", 0.6, 0], bakery: ["#e2c9a0", 0.45, 0], restaurant: ["#8a6545", 0.55, 0], salon: ["#e9e9e9", 0.25, 0.1], electronics: ["#f2f4f6", 0.2, 0.1], eyewear: ["#ece7df", 0.3, 0.05], pcroom: ["#1d1826", 0.7, 0], gym: ["#2a2a2a", 0.95, 0], variety: ["#ece8e0", 0.4, 0] };
  const fl = FLOOR[style];
  if (fl) k.put([M.bx(X.floorFin?.[`shop:${style}`] ?? k.material(fl[0], { roughness: fl[1], metalness: fl[2] }), k.W, 0.006, k.D, 0, 0.003, 0)], new THREE.Matrix4().makeTranslation(k.cx, k.fy, k.cz), false);
  const SHOP: Partial<Record<ShopStyle, import("./shop").ShopKind>> = { cosmetics: "cosmetics", clothing: storeOfName(k.name) === "shoes" ? "shoes" : storeOfName(k.name) === "bags" ? "bags" : "clothing", books: "books", bakery: "bakery", restaurant: "food", electronics: "electronics", eyewear: "eyewear", variety: "variety", pcroom: "convenience", gym: "sports", salon: "cosmetics" };
  const A = X.atlas, store = SHOP[style] ?? "retail";
  /** this shop's goods of the given kinds, a stable pick */
  const goods = (cats: Cat[] | null, n: number, seed: number) => A ? stockFor(store, cats, n, seed + k.name.length * 31) : [];
  const row = (cats: Cat[] | null, len: number, y: number, front: number, maxH: number, seed: number) => A ? shelfRow(A, goods(cats, 30, seed), len, y, front, maxH, seed) : [];
  const till = (w = 1.6) => {
    const f = k.wallPut(k.doorSide, F.moved(F.serviceCounter(P, X, w, 0.6), 0, 1.4), w, 2.0, null, 3);
    if (f) {
      k.put([M.rb(P.applianceDark, 0.3, 0.25, 0.04, 0.01, 0, 1.18, 1.25)], f, false); k.spot(k.at(f, 0, 0, 0.6), k.yawOf(f), "stand", "counter");
      const kind = SHOP[style]; if (kind) k.use(f, [w, 1.1, 0.7, 0, 0.55, 1.4], `${k.name} 계산대에서 사기`, () => { k.fx("scan"); k.shop(kind); });
    }
    return f;
  };
  /** the goods on a shelf, browsed: a pick-up sound and the shop's menu */
  const browse = (f: Frame | null | undefined, len: number, d: number, label: string) => { const kind = SHOP[style]; if (f && kind) k.use(f, [len, 1.8, d, 0, 0.9, d / 2], label, () => { k.fx("pick"); k.shop(kind); }); };
  const backSign = (h = 0.45) => k.sign(k.backSide, [k.name], Math.min(3.2, Math.max(0, k.wallLen(k.backSide) - 1.2)), h, Math.max(2.25, Math.min(k.H - 0.25 - h / 2, 2.7)));
  const rows = (pieceW: number, pieceD: number, gap: number, make: (i: number) => M.Kit, solid = true, onRow?: (f: Frame, len: number, d: number) => void) => {
    const along = k.D > k.W ? "z" : "x", across = along === "z" ? k.W : k.D, len = Math.min(pieceW, (along === "z" ? k.D : k.W) - 3);
    if (len < 0.8) return 0;
    const n = Math.max(1, Math.floor((across - 2.4) / (pieceD + gap))); let made = 0;
    // (and along a long room, several in each row with a walkway between)
    const span = (along === "z" ? k.D : k.W) - 3, per = Math.max(1, Math.min(5, Math.floor((span + 1.4) / (len + 1.4))));
    for (let i = 0; i < n; i++) for (let j = 0; j < per; j++) {
      const o = -((n - 1) * (pieceD + gap)) / 2 + i * (pieceD + gap), a = -((per - 1) * (len + 1.4)) / 2 + j * (len + 1.4);
      const f = along === "z" ? k.freeAt(k.cx + o, k.cz + a, len, pieceD, Math.PI / 2) : k.freeAt(k.cx + a, k.cz + o, len, pieceD, 0);
      if (f) { k.put(make(i * per + j), f, solid); made++; onRow?.(f, len, pieceD); }
    }
    return made;
  };
  switch (style) {
    case "cosmetics": {
      // (bright white shelving with lit edges round the walls, a mirror, testers on low tables in the middle)
      lineWalls(4.6, 0.42, 2.2, (len, s) => [...F.wallShelves(P, X, len, 2.0, 0.38, 6, s.charCodeAt(0) + 3), M.bx(lit, len, 0.02, 0.05, 0, 2.02, 0.36), M.bx(brand, len, 0.18, 0.02, 0, 2.15, 0.02)], (f, len, d) => browse(f, len, d, "화장품 둘러보고 사기"));
      rows(1.8, 0.9, 1.3, i => { const t = A ? tableTop(A, goods(i % 2 ? ["makeup"] : ["skincare", "perfume"], 16, i * 9), 1.7, 0.8, 0.86, i) : []; return [M.rb(X.counterStone ?? P.counter, 1.8, 0.04, 0.9, 0.01, 0, 0.84, 0), M.rb(X.lacquer ?? P.counter, 1.7, 0.82, 0.8, 0.03, 0, 0.41, 0), M.bx(lit, 1.7, 0.015, 0.02, 0, 0.8, 0.41), ...(t.length ? t : Array.from({ length: 10 }, (_, j) => M.cy(X.products[(i + j) % X.products.length], 0.02, 0.02, 0.1 + (j % 3) * 0.03, -0.8 + j * 0.18, 0.9 + 0.05, (j % 2) * 0.3 - 0.15, 10)))]; }, true,
        f => k.use(f, [1.8, 1.0, 0.9, 0, 0.5, 0], "테스터 발라 보기", () => { k.fx("pick"); k.toast(["손등에 립 테스터를 발라 봤어요. 색이 예뻐요!", "향수를 뿌려 봤어요. 은은한 플로럴 향~", "수분 크림을 발라 봤어요. 촉촉해요.", "선크림 테스터… 백탁이 없네요!"][Math.floor(Math.random() * 4)]); }));
      onWall([k.backSide], 1.0, 0.1, 2, () => [M.bx(X.mirrorWall, 1.0, 1.6, 0.02, 0, 1.2, 0.02)], 0.9);
      till(); backSign(); return true;
    }
    case "clothing": {
      // (garment rails round the walls and in the middle, mannequins by the way in, fitting rooms at the back)
      const shoes = store === "shoes", bagsOnly = store === "bags";
      const rail = (len: number, seed: number): M.Kit => {
        const frame: M.Kit = [M.cy(P.chrome, 0.015, 0.015, 1.6, -len / 2, 0.8, 0, 8), M.cy(P.chrome, 0.015, 0.015, 1.6, len / 2, 0.8, 0, 8), M.bx(P.chrome, len, 0.03, 0.03, 0, 1.58, 0)];
        const cl = goods(["tops", "bottoms", "outer"], Math.floor(len / 0.12), seed);
        if (!A || !cl.length) return [...frame, ...Array.from({ length: Math.floor(len / 0.12) }, (_, j) => M.bx(X.products[(seed + j * 3) % X.products.length], 0.04, 0.85 + ((seed + j) % 3) * 0.1, 0.5, -len / 2 + 0.08 + j * 0.12, 1.1 - ((seed + j) % 3) * 0.05, 0))];
        const n = Math.floor((len - 0.3) / 0.12);
        return [...frame, ...cl.slice(0, n).flatMap((p, j) => hangingGarment(A, p, false, P.chrome).map(q => { q.g.translate(-len / 2 + 0.2 + j * 0.12, 1.57, 0); return q; }))];
      };
      if (shoes || bagsOnly) {
        // (a wall of shoes or bags on lit shelves, benches to try them on, a table of the new ones)
        lineWalls(4.6, 0.42, 2.2, (len, s) => { const sh = F.wallShelves(P, { ...X, stock: () => [] }, len, 2.0, 0.38, 6, s.charCodeAt(0)); for (let r = 0; r < 5; r++) sh.push(...row(shoes ? ["shoes"] : ["bags", "jewelry", "watch"], len - 0.06, 0.12 + (2.0 - 0.25) * (r / 5) + 0.01, 0.35, 0.33, r * 7 + s.charCodeAt(0)), M.bx(lit, len - 0.06, 0.01, 0.02, 0, 0.12 + (2.0 - 0.25) * (r / 5) - 0.012, 0.37)); return sh; }, (f, len, d) => browse(f, len, d, shoes ? "신발 신어 보고 사기" : "가방 둘러보고 사기"));
        rows(1.6, 0.8, 1.6, i => [M.rb(X.lacquer ?? P.counter, 1.6, 0.7, 0.8, 0.02, 0, 0.35, 0), M.bx(X.brass ?? P.chrome, 1.6, 0.01, 0.8, 0, 0.705, 0), ...(A ? tableTop(A, goods(shoes ? ["shoes"] : ["bags"], 8, i * 5), 1.5, 0.7, 0.71, i) : [])], true, (f, len, d) => browse(f, len, d, shoes ? "신발 신어 보고 사기" : "가방 둘러보고 사기"));
        const b = k.freeAt(k.cx, k.cz + (k.D > 5 ? k.D / 2 - 1.4 : 0), 1.4, 0.5); if (b) { k.put(F.bench(P, X, 1.4), b, true); k.seat(shoes ? "의자에 앉아 신발 신어 보기" : "벤치에 앉기", k.at(b, 0, 0, 0.25), k.yawOf(b)); }
        till(); backSign(); return true;
      }
      lineWalls(4.2, 0.6, 1.8, (len, s) => F.moved(rail(len, s.charCodeAt(0)), 0, 0.32), (f, len, d) => browse(f, len, d, "옷 골라 보기"));
      rows(2.4, 0.7, 1.4, i => i % 3 === 2 && A ? [M.rb(X.veneer ?? P.woodLight, 2.2, 0.05, 0.7, 0.01, 0, 0.78, 0), M.rb(X.lacquer ?? P.counter, 2.0, 0.76, 0.6, 0.02, 0, 0.38, 0), ...tableTop(A, goods(["tops", "bottoms", "hats", "bags"], 12, i), 2.1, 0.62, 0.805, i)] : rail(2.2, i * 7), true, (f, len, d) => browse(f, len, d, "옷 골라 보기"));
      for (const sx of [-1, 1]) { const f = k.freeAt(k.cx + sx * Math.min(1.6, k.W / 3), k.doorSide === "s" ? k.Z1 - 1.2 : k.doorSide === "n" ? k.Z0 + 1.2 : k.cz, 0.5, 0.5); if (f) k.put(A ? mannequin(A, goods(["tops", "outer"], 1, sx * 3 + 11)[0], goods(["bottoms"], 1, sx * 5 + 2)[0], P.steel, X.paintWhite) : [M.cy(P.steel, 0.15, 0.2, 0.04, 0, 0.02, 0, 16), M.cy(P.steel, 0.012, 0.012, 1.0, 0, 0.5, 0, 6), M.cy(X.products[sx > 0 ? 1 : 3], 0.17, 0.14, 0.62, 0, 1.25, 0, 14), M.cy(X.paintWhite, 0.1, 0.09, 0.2, 0, 1.7, 0, 12)], f, true); }
      onWall([k.backSide], 2.1, 1.3, 2.2, () => [...F.moved(F.cubicle(X, 0.95, 1.2, 2.1), -0.55, 0), ...F.moved(F.cubicle(X, 0.95, 1.2, 2.1), 0.55, 0)], 2.0);
      till(); backSign(); return true;
    }
    case "bank": {
      // (the tellers' counter with glass screens and their windows' numbers, the queue's seats, ATMs by the door)
      const placed = onWall([k.backSide, ...k.sideW], 6, 1.8, 1.3, cw => [M.rb(X.laminate, cw, 1.05, 0.7, 0.02, 0, 0.52, 0.55), M.rb(brand, cw, 0.08, 0.72, 0.01, 0, 1.08, 0.55), ...Array.from({ length: Math.max(1, Math.floor(cw / 1.5) - 1) }, (_, i): M.Part => M.bx(P.glass, 0.02, 0.6, 0.6, -cw / 2 + (i + 1) * cw / Math.max(2, Math.floor(cw / 1.5)), 1.4, 0.6))], 2.4);
      const f = placed?.f, cw = placed?.len ?? 0;
      if (f) { const n = Math.max(2, Math.floor(cw / 1.5)); for (let i = 0; i < n; i++) { const u = -cw / 2 + (i + 0.5) * cw / n; k.spot(k.at(f, u, 0, 0.25), k.yawOf(f), "sit", "counter"); } }
      k.sign(placed?.s ?? k.backSide, [k.name, "번호표를 뽑아 주세요"], Math.min(3, Math.max(1.2, cw)), 0.5, 2.3);
      rows(3, 0.6, 1.0, () => F.beamSeats(P, X, 4), true);
      for (let i = 0; i < 2; i++) { const atm = onWall(k.sideW, 0.8, 0.75, 1.8, () => [M.rb(P.applianceDark, 0.8, 1.7, 0.7, 0.03, 0, 0.85, 0.35), M.bx(X.monitor, 0.4, 0.3, 0.02, 0, 1.25, 0.71), M.bx(brand, 0.8, 0.15, 0.72, 0, 1.75, 0.35)], 0.8);
        if (atm) k.use(atm.f, [0.8, 1.7, 0.7, 0, 0.85, 0.35], "ATM으로 잔액 조회하기", () => { k.fx("atm"); k.toast(`${k.name} ATM · 게임 머니 잔액을 확인했어요 (실제 계좌와는 무관해요)`); }); }
      if (f) k.use(f, [Math.max(1, cw), 1.2, 0.8, 0, 0.6, 0.55], "번호표 뽑고 창구 상담하기", () => { k.fx("chime"); k.toast(`번호표 ${100 + Math.floor(Math.random() * 80)}번 · "고객님, 이쪽 창구로 오세요."`); });
      k.plant(); return true;
    }
    case "books": {
      const TITLES = ["『달러구트 꿈 백화점』", "『불편한 편의점』", "『코스모스』", "『사피엔스』", "『어린 왕자』", "『총, 균, 쇠』", "『아몬드』", "『데미안』", "『미움받을 용기』", "『82년생 김지영』"];
      const read = (f: Frame, len: number, d: number) => k.use(f, [len, 1.8, d, 0, 0.9, d / 2], "책 꺼내 읽어 보기", () => { k.fx("pages"); if (k.read) k.read(); else k.toast(`${TITLES[Math.floor(Math.random() * TITLES.length)]}을(를) 몇 쪽 읽어 봤어요.`); });
      const shelf = (len: number, h: number, seed: number): M.Kit => { const sh = F.wallShelves(P, { ...X, stock: () => [], accent: X.veneer ?? X.accent }, len, h, 0.34, Math.round(h / 0.36), seed); const n = Math.round(h / 0.36), gap = (h - 0.25) / (n - 1); for (let r = 0; r < n - 1; r++) sh.push(...row(seed % 3 ? ["books"] : ["books", "stationery"], len - 0.06, 0.12 + gap * r + 0.01, 0.31, gap - 0.04, seed + r * 11)); return sh; };
      if (A) { lineWalls(5, 0.36, 2.2, (len, s) => shelf(len, 2.2, s.charCodeAt(0)), read); rows(2.6, 0.8, 1.2, i => i % 2 ? [M.rb(X.veneer ?? P.woodLight, 2.4, 0.05, 0.8, 0.01, 0, 0.76, 0), M.rb(P.woodDark, 2.3, 0.74, 0.7, 0.02, 0, 0.37, 0), ...tableTop(A, goods(["books"], 16, i * 3), 2.3, 0.7, 0.785, i).map(q => q)] : [...shelf(2.6, 1.5, i * 13 + 5), ...F.moved(shelf(2.6, 1.5, i * 13 + 9), 0, 0, Math.PI)], true, read); }
      else { lineWalls(5, 0.36, 2.2, len => M.bookshelf(P, len, 2.2), read); rows(2.6, 0.6, 1.2, () => [...M.bookshelf(P, 2.6, 1.5), ...F.moved(M.bookshelf(P, 2.6, 1.5), 0, 0, Math.PI)], true, read); }
      const t = k.freeAt(k.cx, k.cz + (k.D > 6 ? k.D / 2 - 1.8 : 0), 1.8, 0.9, 0, true);
      if (t) { k.put(M.diningTable(P, 1.8, 0.9), t, true); for (const sx of [-0.55, 0.55]) k.seat("의자에 앉아 책 읽기", k.at(t, sx, 0, 0.75), k.yawOf(t) + Math.PI); }
      till(); backSign(); return true;
    }
    case "bakery": {
      const warm = [k.material("#c98a4b"), k.material("#e0b070"), k.material("#a8652f"), k.material("#f1d29a")];
      lineWalls(4, 0.48, 1.7, len => A ? F.wallShelves(P, { ...X, accent: X.veneer ?? X.accent }, len, 1.6, 0.45, 4, 9) : [...F.wallShelves(P, X, len, 1.6, 0.45, 4, 9), ...Array.from({ length: Math.floor(len / 0.22) * 3 }, (_, j) => M.rb(warm[j % 4], 0.16, 0.07, 0.11, 0.03, -len / 2 + 0.12 + (j % Math.floor(len / 0.22)) * 0.22, 0.47 + Math.floor(j / Math.floor(len / 0.22)) * 0.38, 0.22))]);
      // (the glass case of cakes on the counter, the tray-and-tongs table in the middle)
      const f = till(2.2); if (f) k.put([M.bx(P.glass, 1.4, 0.4, 0.5, 0.2, 1.32, 1.85), M.bx(lit, 1.3, 0.01, 0.45, 0.2, 1.5, 1.85), ...Array.from({ length: 6 }, (_, i) => M.cy(warm[i % 4], 0.07, 0.07, 0.08, -0.35 + i * 0.13, 1.18, 1.85, 14))], f, false);
      rows(1.4, 0.8, 1.4, i => [M.rb(X.veneer ?? P.counter, 1.4, 0.85, 0.8, 0.03, 0, 0.42, 0), ...(A ? tableTop(A, goods(["bakery", "dessert"], 12, i), 1.3, 0.7, 0.85, i) : Array.from({ length: 8 }, (_, j) => M.rb(warm[(i + j) % 4], 0.16, 0.07, 0.11, 0.03, -0.55 + (j % 4) * 0.36, 0.9, j < 4 ? -0.18 : 0.18)))], true, (f, len, d) => browse(f, len, d, "쟁반에 빵 담기"));
      backSign(); return true;
    }
    case "restaurant": {
      // (the kitchen's pass along the back, tables for four in a grid, pendants over them)
      const pass = onWall([k.backSide, ...k.sideW], 5, 1.6, 1.3, bw => [...F.serviceCounter(P, X, bw, 0.6), M.bx(P.steel, bw, 0.6, 0.05, 0, 1.6, 0.02), M.bx(lit, bw * 0.9, 0.02, 0.4, 0, 2.2, 0.3)], 1.8);
      if (pass) k.use(pass.f, [pass.len, 1.1, 0.7, 0, 0.55, 0.3], "주방에 음식 주문하기", () => { k.fx("register"); k.shop("food"); });
      if (pass) { const { f, len: bw } = pass; k.spot(k.at(f, -bw / 4, 0, 0.2), k.yawOf(f), "stand", "counter"); k.spot(k.at(f, bw / 4, 0, 0.2), k.yawOf(f), "stand", "counter"); }
      let first = true;
      for (let x = k.X0 + 1.3; x < k.X1 - 1.0; x += 2.2) for (let z = k.Z0 + 1.3; z < k.Z1 - 1.0; z += 2.0) {
        const t = k.freeAt(x, z, 1.2, 1.6, 0, true); if (!t) continue;
        k.put([...M.diningTable(P, 1.0, 0.75)], t, true);
        for (const [sx, sz, face] of [[0, -0.6, 0], [0, 0.6, Math.PI]] as const) {
          const m = new THREE.Matrix4().makeRotationY(face).setPosition(x + sx, 0, z + sz).premultiply(new THREE.Matrix4().makeTranslation(0, t.m.elements[13], 0));
          k.put(F.stackChair(P, X), m, false);
          if (first) { k.seat("의자에 앉기", new THREE.Vector3(x + sx, 0, z + sz), face); first = false; }
        }
        k.put(M.pendant(P, 0.8), new THREE.Matrix4().makeTranslation(x, k.H, z), false);
      }
      backSign(); return true;
    }
    case "salon": {
      // (a row of stations — a mirror, a counter, a chair — along a wall; the basins at the back; a bench to wait)
      const stations = (len: number) => { const n = Math.max(1, Math.floor(len / 1.3)); return Array.from({ length: n }, (_, i) => { const u = -len / 2 + (i + 0.5) * len / n; return [M.bx(X.mirrorWall, 0.8, 1.1, 0.02, u, 1.45, 0.02), M.rb(X.laminate, 1.0, 0.06, 0.35, 0.01, u, 0.85, 0.18), M.bx(lit, 0.8, 0.03, 0.03, u, 2.05, 0.04)]; }).flat(); };
      const row = onWall(k.sideW, 7, 0.4, 2.1, stations, 1.3);
      if (row) {
        const { f, len } = row, n = Math.max(1, Math.floor(len / 1.3));
        k.use(f, [len, 1.2, 0.5, 0, 1.2, 0.2], "거울 앞에서 머리 손질 받기", () => { k.fx("pick"); setTimeout(() => k.fx("pick"), 250); k.toast(["앞머리를 살짝 다듬었어요. 상쾌해요!", "드라이로 볼륨을 살렸어요.", "디자이너: \"오늘 스타일 정말 잘 어울리세요!\""][Math.floor(Math.random() * 3)]); });
        for (let i = 0; i < n; i++) { const u = -len / 2 + (i + 0.5) * len / n, p = k.at(f, u, 0, 0.95); k.put(F.taskChair(P, X), new THREE.Matrix4().makeRotationY(k.yawOf(f) + Math.PI).setPosition(p.x, 0, p.z).premultiply(new THREE.Matrix4().makeTranslation(0, f.m.elements[13], 0)), false); if (i % 2 === 0) k.spot(k.at(f, u + 0.45, 0, 1.2), k.yawOf(f), "stand", "stand"); }
      }
      onWall([k.backSide], 2.4, 0.6, 1.2, len => F.basinCounter(P, X, len, 2), 1.4);
      const w = k.wallPut(k.sideW[1] ?? k.doorSide, F.bench(P, X, 1.6), 1.6, 0.5, null, 1); if (w) k.seat("소파에 앉아 기다리기", k.at(w, 0, 0, 0.25), k.yawOf(w));
      till(1.2); backSign(); return true;
    }
    case "electronics": {
      // (long display tables of phones and laptops, a wall of screens, consultation desks)
      const device = (j: number, x: number, z: number): M.Kit => j % 3 === 2 ? [M.rb(P.applianceDark, 0.34, 0.02, 0.24, 0.005, x, 0.92, z), M.bx(X.monitor, 0.32, 0.2, 0.01, x, 1.02, z - 0.11)] : [M.rb(P.applianceDark, 0.08, 0.16, 0.01, 0.005, x, 0.97, z), M.bx(X.monitor, 0.07, 0.14, 0.002, x, 0.97, z + 0.006)];
      rows(2.4, 1.0, 1.3, () => [M.rb(X.laminate, 2.4, 0.88, 1.0, 0.03, 0, 0.44, 0), M.bx(brand, 2.4, 0.03, 1.0, 0, 0.885, 0), ...Array.from({ length: 10 }, (_, j) => device(j, -1.0 + (j % 5) * 0.5, j < 5 ? -0.25 : 0.25)).flat()], true,
        f => k.use(f, [2.4, 1.1, 1.0, 0, 0.55, 0], "전시된 최신 기기 만져 보기", () => { k.fx("keys"); k.toast(["새 폴더블폰을 접었다 펴 봤어요. 화면이 매끈해요!", "카메라로 셀카를 찍어 봤어요. 화질 최고!", "노트북 키보드를 두드려 봤어요. 타건감이 좋네요.", "무선 이어폰 노이즈 캔슬링… 세상이 조용해졌어요."][Math.floor(Math.random() * 4)]); }));
      onWall([k.backSide], 4.5, 0.12, 2.3, len => [...Array.from({ length: Math.max(1, Math.floor(len / 0.9)) * 2 }, (_, j) => M.bx(X.monitor, 0.8, 0.45, 0.04, -len / 2 + 0.45 + (j % Math.max(1, Math.floor(len / 0.9))) * 0.9, 1.3 + Math.floor(j / Math.max(1, Math.floor(len / 0.9))) * 0.55, 0.05)), M.bx(brand, len, 0.2, 0.03, 0, 2.25, 0.02)], 1.5);
      const desk = onWall(k.sideW, 1.4, 0.75, 1, () => F.officeDesk(P, X, 1.4, 0.7, 1), 1.4); if (desk) k.spot(k.at(desk.f, 0, 0, 0.1), k.yawOf(desk.f), "sit", "counter");
      if (A) { const sw = onWall(k.sideW.slice().reverse(), 3.6, 0.42, 2.1, len => F.wallShelves(P, X, len, 2.0, 0.4, 5, 21), 1.4); if (sw) browse(sw.f, sw.len, 0.42, "전자기기 둘러보고 사기"); }
      till(1.6);
      backSign(); return true;
    }
    case "eyewear": {
      lineWalls(4.5, 0.3, 2.1, len => [M.bx(X.veneer ?? X.laminate, len, 2.0, 0.25, 0, 1.0, 0.12), ...Array.from({ length: 6 }, (_, r) => M.bx(lit, len - 0.1, 0.012, 0.2, 0, 0.7 + r * 0.22, 0.14)), ...(A ? Array.from({ length: 6 }, (_, r) => row(r % 2 ? ["glasses"] : ["sunglasses"], len - 0.12, 0.706 + r * 0.22, 0.26, 0.2, r * 5)).flat() : Array.from({ length: Math.floor(len / 0.18) * 6 }, (_, j) => M.bx(P.applianceDark, 0.13, 0.04, 0.012, -len / 2 + 0.12 + (j % Math.floor(len / 0.18)) * 0.18, 0.73 + Math.floor(j / Math.floor(len / 0.18)) * 0.22, 0.2)))], (f, len, d) => browse(f, len, d, "선글라스·안경 써 보고 사기"));
      const t = k.freeAt(k.cx, k.cz, 1.2, 0.7); if (t) { k.put([...F.officeDesk(P, X, 1.2, 0.7, 0), M.bx(X.mirrorWall, 0.3, 0.4, 0.02, 0.35, 1.0, -0.2)], t, true); k.seat("의자에 앉아 안경 써 보기", k.at(t, 0, 0, 0.65), k.yawOf(t) + Math.PI);
        k.use(t, [1.2, 1.0, 0.7, 0, 0.6, 0], "시력 검사 받기", () => { k.fx("chime"); k.toast(`시력 검사 결과 · 왼쪽 ${(0.8 + Math.random() * 0.7).toFixed(1)} · 오른쪽 ${(0.8 + Math.random() * 0.7).toFixed(1)}`); }); }
      till(1.4); backSign(); return true;
    }
    case "pcroom": {
      // (rows of double desks, a PC at each seat: a monitor whose screen is the computer (furnish.ts
      // makes a flat screen usable — here, PcGames), a lit keyboard, a mouse on its pad, a tower with
      // its glow, a headset hung by it, a gaming chair pulled up)
      const dark = k.material("#16101f"), glow = k.material("#7b2cbf", { emissive: "#7b2cbf", emissiveIntensity: 0.9 }), rgb = k.material("#28d7ff", { emissive: "#28d7ff", emissiveIntensity: 1.2 });
      const keycap = k.material("#2a2a30", { roughness: 0.6 }), pad = k.material("#101014", { roughness: 0.95 }), red = k.material("#ff3b5c", { emissive: "#ff3b5c", emissiveIntensity: 0.8 });
      const plane = (w: number, h: number, x: number, y: number, z: number, back: boolean): M.Part => ({ m: X.monitor, g: new THREE.PlaneGeometry(w, h).rotateY(back ? Math.PI : 0).translate(x, y, z) });
      const station = (x: number, side: 1 | -1): M.Kit => {
        const z = side * 0.55, f = side; // (screen faces the seat on its side)
        return [
          M.rb(P.applianceDark, 0.64, 0.4, 0.035, 0.012, x, 1.04, z), plane(0.6, 0.355, x, 1.04, z + f * 0.019, side < 0),
          M.bx(P.applianceDark, 0.05, 0.2, 0.05, x, 0.84, z - f * 0.02), M.rb(P.applianceDark, 0.24, 0.015, 0.16, 0.006, x, 0.752, z - f * 0.02),
          M.rb(keycap, 0.44, 0.022, 0.14, 0.006, x - 0.03, 0.756, side * 0.22), M.bx(rgb, 0.44, 0.004, 0.006, x - 0.03, 0.748, side * 0.22 + f * 0.07),
          ...Array.from({ length: 5 }, (_, r) => M.bx(k.material(r % 2 ? "#3a3a42" : "#33333a"), 0.4, 0.006, 0.018, x - 0.03, 0.769, side * 0.22 - f * 0.05 + f * r * 0.024)),
          M.rb(pad, 0.26, 0.004, 0.22, 0.002, x + 0.33, 0.747, side * 0.22), M.rb(P.applianceDark, 0.06, 0.03, 0.1, 0.02, x + 0.33, 0.762, side * 0.22), M.bx(red, 0.012, 0.004, 0.03, x + 0.33, 0.778, side * 0.22 + f * 0.02),
          M.rb(P.applianceDark, 0.2, 0.46, 0.42, 0.02, x + 0.62, 0.23, side * 0.42), M.bx(rgb, 0.004, 0.4, 0.004, x + 0.52, 0.25, side * 0.42 + f * 0.2),
          { m: P.applianceDark, g: new THREE.TorusGeometry(0.09, 0.012, 6, 16, Math.PI).translate(x - 0.34, 1.0, z - f * 0.03) },
        ];
      };
      const desk = (len: number, n: number): M.Kit => [M.rb(dark, len, 0.74, 0.7, 0.02, 0, 0.37, -0.4), M.rb(dark, len, 0.74, 0.7, 0.02, 0, 0.37, 0.4), M.bx(glow, len, 0.02, 0.02, 0, 0.75, 0), M.bx(P.applianceDark, len, 0.32, 0.02, 0, 0.9, 0),
        ...Array.from({ length: n }, (_, j) => { const x = -len / 2 + (j + 0.5) * len / n; return [...station(x, 1), ...station(x, -1)]; }).flat()];
      const chairs = (f: Frame, len: number, n: number) => { for (let j = 0; j < n; j++) for (const side of [1, -1]) { const x = -len / 2 + (j + 0.5) * len / n, p = k.at(f, x, 0, side * 1.0); k.put(F.taskChair(P, X), new THREE.Matrix4().makeRotationY(k.yawOf(f) + (side > 0 ? Math.PI : 0)).setPosition(p.x, f.m.elements[13], p.z), false); if (j === 0 && side > 0) k.seat("의자에 앉아 PC 하기", k.at(f, x, 0, side * 0.95), k.yawOf(f) + (side > 0 ? Math.PI : 0)); if ((j + (side > 0 ? 0 : 1)) % 3 === 0) k.spot(k.at(f, x, 0, side * 0.95), k.yawOf(f) + (side > 0 ? Math.PI : 0), "sit", "desk"); } };
      let made = rows(4, 2.6, 0.6, () => desk(4, 5), true, (f, len) => chairs(f, len, 5));
      if (!made) made = rows(2.4, 2.6, 0.5, () => desk(2.4, 3), true, (f, len) => chairs(f, len, 3));
      if (!made) lineWalls(4, 0.75, 1.2, len => [M.rb(dark, len, 0.74, 0.7, 0.02, 0, 0.37, 0.35), ...Array.from({ length: Math.floor(len / 0.8) }, (_, j) => station(-len / 2 + 0.4 + j * 0.8, 1).map(p => { p.g.translate(0, 0, -0.2); return p; })).flat()]);
      till(1.6); backSign(0.5); return true;
    }
    case "gym": {
      for (let i = 0; i < 4; i++) { const tm = onWall(k.sideW, 0.8, 1.8, 1.0, () => F.treadmill(P, X), 0.8); if (!tm) break; k.use(tm.f, [0.8, 1.4, 1.8, 0, 0.7, 0.9], "러닝머신 달리기", () => { k.fx("treadmill"); k.toast(`러닝머신 ${5 + Math.floor(Math.random() * 20)}분 · ${(1 + Math.random() * 3).toFixed(1)}km 달렸어요!`); }); }
      onWall([k.sideW[1] ?? k.backSide], 4, 0.1, 2.2, len => [M.bx(X.mirrorWall, len, 2.0, 0.02, 0, 1.2, 0.02)], 1.5);
      onWall([k.backSide], 1.8, 0.5, 1, () => F.dumbbellRack(P, 1.8), 1.8);
      rows(1.4, 0.6, 1.6, () => F.weightBench(P, X), true);
      till(1.4); backSign(); return true;
    }
    case "variety": {
      lineWalls(5, 0.44, 2.2, (len, s) => [...F.wallShelves(P, X, len, 2.0, 0.42, 6, s.charCodeAt(0) * 3), M.bx(brand, len, 0.16, 0.02, 0, 2.12, 0.02)], (f, len, d) => browse(f, len, d, "생활용품 둘러보고 사기"));
      rows(3.2, 0.9, 1.1, i => F.gondola(P, X, 3.2, i * 11 + 2), true, (f, len, d) => browse(f, len, d, "생활용품 둘러보고 사기"));
      till(); backSign(); return true;
    }
  }
  return false;
}

/** A supermarket: chiller walls of drinks and dairy, produce tables by the way in, aisles of
 * gondolas end to end, checkout lanes with their belts and scanners at the front, trolleys. Every
 * shelf can be browsed and bought from; the tills ring. */
function mart(k: ShopKit): boolean {
  const { P, X } = k, brand = k.material(brandColour(k.name, "convenience"));
  const fresh = [k.material("#d62828"), k.material("#f6d64a"), k.material("#2e7d32"), k.material("#f77f00"), k.material("#8ac926")];
  k.put([M.bx(X.floorFin?.["shop:mart"] ?? k.material("#e9e6df", { roughness: 0.25, metalness: 0.05 }), k.W, 0.006, k.D, 0, 0.003, 0)], new THREE.Matrix4().makeTranslation(k.cx, k.fy, k.cz), false);
  const ALL: SideName[] = ["n", "s", "w", "e"];
  const buy = (f: Frame, w: number, d: number, label: string) => k.use(f, [w, 1.8, d, 0, 0.9, d / 2], label, () => { k.fx("pick"); k.shop("mart"); });
  // (the chillers round the walls)
  for (const s of ALL.filter(x => x !== k.doorSide)) {
    const len = Math.min(5, k.wallLen(s) - 1.2); if (len < 1.5) continue;
    for (let r = 0; r < 6; r++) { const f = k.wallPut(s, [...F.cooler(P, X, len), M.bx(brand, len, 0.2, 0.03, 0, 2.15, 0.02)], len, 0.75, null, 2.2) ?? k.wallPut(s, F.wallShelves(P, X, len, 1.6, 0.45, 5, r + 3), len, 0.47, null, 1.0); if (!f) break; buy(f, len, 0.75, s === k.backSide ? "냉장 코너에서 음료·유제품 고르기" : "진열대에서 상품 고르기"); }
  }
  // (aisles of gondolas, end to end)
  const along = k.D > k.W ? "z" : "x", across = along === "z" ? k.W : k.D, span = (along === "z" ? k.D : k.W) - 6.5;
  const n = Math.max(1, Math.floor((across - 3) / 2.1)), len = Math.min(4, Math.max(1.6, span)), per = Math.max(1, Math.floor((span + 1.6) / (len + 1.6)));
  for (let i = 0; i < n; i++) for (let j = 0; j < per; j++) {
    const o = -((n - 1) * 2.1) / 2 + i * 2.1, a = -((per - 1) * (len + 1.6)) / 2 + j * (len + 1.6) + (k.doorSide === "s" || k.doorSide === "e" ? -1.2 : 1.2);
    const f = along === "z" ? k.freeAt(k.cx + o, k.cz + a, len, 0.9, Math.PI / 2) : k.freeAt(k.cx + a, k.cz + o, len, 0.9, 0);
    if (f) { k.put(F.gondola(P, X, len, i * 7 + j * 3 + 1), f, true); buy(f, len, 0.9, ["라면·과자 코너 둘러보기", "생활용품 코너 둘러보기", "음료 코너 둘러보기", "조미료·통조림 코너 둘러보기"][(i + j) % 4]); }
  }
  // (produce tables near the way in, heaped with fruit)
  for (const dx of [-1.6, 1.6]) {
    const z = k.doorSide === "s" ? k.Z1 - 3 : k.doorSide === "n" ? k.Z0 + 3 : k.cz, x = k.doorSide === "w" ? k.X0 + 3 : k.doorSide === "e" ? k.X1 - 3 : k.cx + dx;
    const f = k.freeAt(x, k.doorSide === "w" || k.doorSide === "e" ? k.cz + dx : z, 1.4, 1.0); if (!f) continue;
    const prod = X.atlas ? tableTop(X.atlas, stockFor("mart", ["fresh"], 8, Math.round(dx * 10) + 40), 1.3, 0.9, 0.76, Math.round(dx * 10) + 40) : [];
    k.put([M.rb(P.woodLight, 1.4, 0.75, 1.0, 0.03, 0, 0.375, 0), ...(prod.length ? prod : Array.from({ length: 24 }, (_, q) => M.cy(fresh[q % fresh.length], 0.045, 0.045, 0.08, -0.6 + (q % 8) * 0.17, 0.79 + Math.floor(q / 8) * 0.03, -0.35 + Math.floor(q / 8) * 0.35, 10)))], f, true);
    k.use(f, [1.4, 0.9, 1.0, 0, 0.45, 0], "신선 과일 고르기", () => { k.fx("pick"); k.shop("mart"); });
  }
  // (checkout lanes along the front: a belt, a scanner, a till, a lane light)
  const lanes = Math.max(1, Math.min(4, Math.floor((k.wallLen(k.doorSide) - 3) / 2.4)));
  for (let i = 0; i < lanes; i++) {
    const f = k.wallPut(k.doorSide, [M.rb(X.laminate, 0.7, 0.9, 1.9, 0.02, 0, 0.45, 1.6), M.bx(P.rubber, 0.5, 0.02, 1.5, 0, 0.91, 1.65), M.bx(P.applianceDark, 0.3, 0.25, 0.3, 0.2, 1.05, 0.9), M.bx(X.monitor, 0.25, 0.18, 0.02, 0.2, 1.25, 0.76), M.cy(P.steel, 0.02, 0.02, 1.6, -0.3, 0.8, 2.5, 8), M.bx(brand, 0.3, 0.2, 0.05, -0.3, 1.7, 2.5)], 0.9, 2.6, null, 1.3);
    if (!f) break;
    k.spot(k.at(f, 0.65, 0, 1.6), k.yawOf(f) - Math.PI / 2, "stand", "counter");
    k.use(f, [0.9, 1.2, 1.9, 0, 0.6, 1.6], `${i + 1}번 계산대에서 계산하기`, () => { k.fx("scan"); setTimeout(() => k.fx("scan"), 220); setTimeout(() => k.fx("register"), 500); k.shop("mart"); });
  }
  // (a few trolleys by the way in)
  for (let t = 0; t < 3; t++) { const f = k.freeAt(k.X0 + 1 + t * 0.7, k.doorSide === "s" ? k.Z1 - 0.9 : k.Z0 + 0.9, 0.55, 0.9); if (f) k.put([M.bx(P.chrome, 0.5, 0.45, 0.8, 0, 0.75, 0), M.bx(P.rubber, 0.5, 0.05, 0.75, 0, 0.12, 0), M.cy(P.rubber, 0.05, 0.05, 0.04, -0.22, 0.05, -0.3, 8), M.cy(P.rubber, 0.05, 0.05, 0.04, 0.22, 0.05, 0.3, 8)], f, false); }
  k.sign(k.backSide, [k.name], Math.min(4, Math.max(1, k.wallLen(k.backSide) - 1.2)), 0.5, 2.4);
  return true;
}
