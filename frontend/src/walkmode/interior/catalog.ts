/* The goods of the game's shops: several hundred products, each with its (made-up) brand, name,
 * price, colours and the shape it is shown in — on a shelf, a rail, a table (productDisplay.ts) and
 * in the shop's menu as a picture (productArt.ts). Generated from tables, the same every visit (the
 * ids are what the bag in localStorage keeps). Brands and titles are invented, not real ones. */

export type Form =
  | "book" | "notebook" | "box" | "device" | "bottle" | "pump" | "jar" | "tube" | "lipstick" | "compact" | "perfume" | "pouch" | "sheet"
  | "can" | "carton" | "pet" | "cup" | "tee" | "shirt" | "pants" | "dress" | "coat" | "folded" | "shoe" | "boot" | "heel" | "bag" | "backpack"
  | "wallet" | "sunglasses" | "glasses" | "watch" | "ring" | "necklace" | "cap" | "fruit" | "tray" | "bread" | "cake" | "pen" | "mug" | "plant" | "toy" | "ball";
export type Cat =
  | "makeup" | "skincare" | "perfume" | "hair" | "tops" | "bottoms" | "outer" | "shoes" | "bags" | "sunglasses" | "glasses" | "watch" | "jewelry" | "hats"
  | "books" | "stationery" | "electronics" | "snack" | "drink" | "fresh" | "grocery" | "household" | "bakery" | "dessert" | "coffee" | "meal" | "health"
  | "kitchen" | "deco" | "toys" | "sports";
export interface Product {
  id: string; name: string; brand: string; cat: Cat; form: Form; price: number;
  kind: "drink" | "food" | "goods"; how?: "can" | "bottle" | "cup" | "carton" | "soft" | "crunch";
  /** main, second and accent colours (packaging, fabric, label) */
  color: string; color2: string; ink: string;
  /** a short line for the menu (size, volume, genre) */
  desc: string;
  /** which of the form's designs (pattern, cover art) */
  seed: number;
}
export const CAT_LABEL: Record<Cat, string> = {
  makeup: "메이크업", skincare: "스킨케어", perfume: "향수", hair: "헤어·바디", tops: "상의", bottoms: "하의", outer: "아우터", shoes: "신발", bags: "가방", sunglasses: "선글라스",
  glasses: "안경", watch: "시계", jewelry: "주얼리", hats: "모자", books: "도서", stationery: "문구·노트", electronics: "디지털", snack: "과자·간식", drink: "음료", fresh: "신선식품",
  grocery: "가공식품", household: "생활용품", bakery: "빵", dessert: "디저트", coffee: "커피·음료", meal: "식사", health: "건강·의약", kitchen: "주방", deco: "홈데코", toys: "장난감", sports: "스포츠",
};

const hashOf = (s: string) => { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const COLOURS: [string, string][] = [["블랙", "#1c1c1e"], ["화이트", "#f4f4f1"], ["네이비", "#1f2f4f"], ["베이지", "#d8c4a4"], ["그레이", "#8e9094"], ["카키", "#5d6247"], ["버건디", "#6e1f2f"], ["스카이", "#9cc6e8"], ["크림", "#efe6d2"], ["브라운", "#6b4a33"], ["올리브", "#7a7a3a"], ["핑크", "#f1b8c4"], ["레드", "#c4232f"], ["민트", "#a8dccb"], ["라벤더", "#b9a9d9"], ["옐로", "#f2cf4a"]];
const PASTEL = ["#f6d6dc", "#f8e6c8", "#d9ecdf", "#d6e4f4", "#e7dcf2", "#f4efe6", "#fbe3d3", "#e2efe9", "#efe0d6", "#dbe8f0"];
const VIVID = ["#e63946", "#f4a261", "#2a9d8f", "#264653", "#e9c46a", "#8338ec", "#3a86ff", "#ff006e", "#fb5607", "#06d6a0", "#118ab2", "#ef476f", "#ffd166", "#073b4c", "#9b5de5", "#00bbf9"];
const DEEP = ["#1d3557", "#3d405b", "#2b2d42", "#5f0f40", "#0b3d2e", "#432818", "#22223b", "#14213d", "#3c1642", "#1b4332"];

const out: Product[] = [];
let n = 0;
function add(p: Omit<Product, "id" | "seed" | "color2" | "ink"> & Partial<Pick<Product, "color2" | "ink">>) {
  const id = `p${(hashOf(`${p.cat}|${p.brand}|${p.name}`) % 0xfffff).toString(36)}${(n++).toString(36)}`;
  out.push({ ...p, id, seed: hashOf(p.name + p.brand), color2: p.color2 ?? p.color, ink: p.ink ?? "#ffffff" });
}
const won = (base: number, h: number, spread = 0.4) => Math.max(500, Math.round(base * (1 - spread / 2 + ((h % 1000) / 1000) * spread) / 100) * 100);

// ---- beauty ----
const BEAUTY = ["루미에르", "그린티아", "모아베", "스킨랩", "오르시아", "베르디", "라온", "미엘", "솔레아", "누아"];
const SHADES: [string, string][] = [["로즈 브릭", "#a8323e"], ["코랄 썸머", "#f27a6b"], ["누드 베이지", "#c98f7a"], ["체리 레드", "#b3142a"], ["플럼 와인", "#6b1f3a"], ["피치 블러썸", "#f4a28c"], ["모브 핑크", "#c47a8e"], ["오렌지 칠리", "#d9481c"]];
BEAUTY.slice(0, 6).forEach((b, i) => SHADES.slice(i % 3, i % 3 + 5).forEach(([s, c]) => add({ cat: "makeup", brand: b, name: `${b} 벨벳 립스틱 ${s}`, form: "lipstick", price: won(24000, hashOf(b + s)), kind: "goods", color: c, color2: i % 2 ? "#1a1a1a" : "#c9a24a", desc: "립스틱 3.5g" })));
BEAUTY.slice(2, 8).forEach((b, i) => SHADES.slice(i % 4, i % 4 + 3).forEach(([s, c]) => add({ cat: "makeup", brand: b, name: `${b} 글로우 틴트 ${s}`, form: "tube", price: won(15000, hashOf(b + s + "t")), kind: "goods", color: c, color2: "#f4f1ec", desc: "워터 틴트 4g" })));
const MAKE: [string, Form, number, string][] = [["쿠션 팩트", "compact", 38000, "21호 · 15g×2"], ["파운데이션", "pump", 48000, "30ml SPF30"], ["아이섀도 팔레트", "compact", 42000, "12색"], ["볼륨 마스카라", "lipstick", 26000, "8g"], ["펜슬 아이라이너", "pen", 14000, "0.5g"], ["치크 블러셔", "compact", 28000, "5g"], ["컨실러", "tube", 22000, "6.5g"], ["메이크업 픽서", "bottle", 24000, "100ml"]];
BEAUTY.forEach((b, i) => MAKE.forEach(([t, f, p, d], j) => { if ((i + j) % 2) add({ cat: "makeup", brand: b, name: `${b} ${t}`, form: f, price: won(p, hashOf(b + t)), kind: "goods", color: PASTEL[(i + j) % PASTEL.length], color2: [`#c9a24a`, "#1a1a1a", "#ffffff"][(i + j) % 3], ink: "#2a2a2a", desc: d }); }));
const SKIN: [string, Form, number, string][] = [["수분 토너", "bottle", 22000, "200ml"], ["비타 에센스", "bottle", 36000, "50ml"], ["히알루론 세럼", "bottle", 39000, "30ml"], ["시카 앰플", "bottle", 34000, "30ml"], ["수분 크림", "jar", 32000, "50ml"], ["아이 크림", "jar", 45000, "25ml"], ["톤업 선크림", "tube", 21000, "50ml SPF50+"], ["약산성 클렌징폼", "tube", 13000, "150ml"], ["딥 클렌징 오일", "pump", 26000, "200ml"], ["진정 마스크팩", "sheet", 12000, "10매"], ["슬리핑 팩", "jar", 28000, "80ml"], ["립 밤", "lipstick", 9000, "3.8g"], ["핸드 크림", "tube", 8000, "50ml"], ["바디 로션", "pump", 18000, "400ml"]];
BEAUTY.forEach((b, i) => SKIN.forEach(([t, f, p, d], j) => { if ((i * 3 + j) % 3 !== 1) add({ cat: "skincare", brand: b, name: `${b} ${t}`, form: f, price: won(p, hashOf(b + t)), kind: "goods", color: PASTEL[(i * 2 + j) % PASTEL.length], color2: ["#7fb59a", "#c9a24a", "#4a6fa5", "#d98c9f"][i % 4], ink: "#2b2b2b", desc: d }); }));
const SCENTS = ["블랑쉬 머스크", "로즈 드 메", "시트러스 비치", "우디 앰버", "화이트 티", "블랙 체리", "라벤더 필드", "베르가못 네롤리", "샌달우드", "피오니 블룸"];
SCENTS.forEach((s, i) => add({ cat: "perfume", brand: BEAUTY[(i * 3) % BEAUTY.length], name: `${s} 오 드 퍼퓸`, form: "perfume", price: won(89000, hashOf(s), 0.6), kind: "goods", color: ["#f3d9b1", "#e8b4c0", "#f6e27a", "#a86b3c", "#e9efe6", "#5a1028", "#b7a6dd", "#f2c46d", "#8c5a3c", "#f7c6d2"][i], color2: "#d4af37", ink: "#1e1e1e", desc: "50ml EDP" }));
const HAIR: [string, Form, number, string][] = [["데미지 케어 샴푸", "pump", 16000, "500ml"], ["실크 트리트먼트", "pump", 18000, "500ml"], ["헤어 에센스", "bottle", 15000, "100ml"], ["바디 워시", "pump", 13000, "750ml"], ["헤어 왁스", "jar", 11000, "80g"], ["퍼퓸 바디 미스트", "bottle", 19000, "150ml"]];
BEAUTY.slice(0, 5).forEach((b, i) => HAIR.forEach(([t, f, p, d], j) => add({ cat: "hair", brand: b, name: `${b} ${t}`, form: f, price: won(p, hashOf(b + t)), kind: "goods", color: [...PASTEL, ...VIVID][(i * 5 + j) % 26], color2: "#ffffff", ink: "#222", desc: d })));

// ---- fashion ----
const LABELS = ["노스레인", "어반믹스", "데일리룸", "모노그램", "블루케이브", "선데이랩", "코지핏", "아틀리에K"];
const TOPS: [string, Form, number][] = [["오버핏 반팔 티셔츠", "tee", 19900], ["코튼 긴팔 티셔츠", "tee", 25900], ["옥스포드 셔츠", "shirt", 39900], ["스트라이프 셔츠", "shirt", 42900], ["케이블 니트", "tee", 59900], ["후드 스웨트셔츠", "tee", 49900], ["맨투맨", "tee", 39900], ["린넨 블라우스", "shirt", 45900]];
const BOTTOMS: [string, Form, number][] = [["와이드 데님", "pants", 59900], ["스트레이트 청바지", "pants", 54900], ["울 슬랙스", "pants", 69900], ["코튼 치노", "pants", 45900], ["플리츠 스커트", "dress", 49900], ["조거 팬츠", "pants", 39900]];
const OUTERS: [string, Form, number][] = [["울 블렌드 코트", "coat", 189000], ["숏 패딩", "coat", 159000], ["트렌치코트", "coat", 179000], ["데님 재킷", "coat", 89000], ["니트 가디건", "shirt", 69000], ["플리스 재킷", "coat", 79000], ["셋업 블레이저", "coat", 129000], ["롱 원피스", "dress", 89000]];
const PRINTS = ["무지", "스트라이프", "로고", "체크"];
const garment = (list: [string, Form, number][], cat: Cat) => list.forEach(([t, f, p], i) => COLOURS.forEach(([cn, c], j) => {
  if ((i * 5 + j) % 3) return;
  const brand = LABELS[(i + j) % LABELS.length], pr = PRINTS[(i + j * 3) % 4];
  add({ cat, brand, name: `${brand} ${t} ${cn}`, form: f, price: won(p, hashOf(t + cn), 0.25), kind: "goods", color: c, color2: pr === "무지" ? c : COLOURS[(j + 5) % COLOURS.length][1], ink: j === 1 || j === 8 ? "#222222" : "#ffffff", desc: `${pr} · ${["S", "M", "L", "XL"][(i + j) % 4]}` });
}));
garment(TOPS, "tops"); garment(BOTTOMS, "bottoms"); garment(OUTERS, "outer");
const SHOES: [string, Form, number][] = [["클래식 스니커즈", "shoe", 89000], ["러닝화", "shoe", 129000], ["캔버스 하이탑", "boot", 69000], ["가죽 로퍼", "shoe", 139000], ["첼시 부츠", "boot", 169000], ["스트랩 샌들", "heel", 59000], ["펌프스 힐", "heel", 99000], ["트레킹화", "boot", 149000], ["슬립온", "shoe", 49000], ["더비 구두", "shoe", 159000]];
const SHOEBRANDS = ["스트라이드", "에어로", "풋노트", "카미노", "베이스런"];
SHOES.forEach(([t, f, p], i) => COLOURS.forEach(([cn, c], j) => { if ((i + j) % 4) return; const b = SHOEBRANDS[(i + j) % 5]; add({ cat: "shoes", brand: b, name: `${b} ${t} ${cn}`, form: f, price: won(p, hashOf(t + cn), 0.2), kind: "goods", color: c, color2: VIVID[(i * 3 + j) % VIVID.length], ink: "#ffffff", desc: `${230 + ((i + j) % 8) * 5}mm` }); }));
const BAGS: [string, Form, number][] = [["레더 토트백", "bag", 189000], ["미니 숄더백", "bag", 129000], ["크로스백", "bag", 89000], ["나일론 백팩", "backpack", 99000], ["캔버스 에코백", "bag", 29000], ["반지갑", "wallet", 79000], ["카드지갑", "wallet", 49000], ["버킷백", "bag", 149000], ["클러치", "wallet", 99000]];
const BAGBRANDS = ["메종로우", "카르테", "피에몬", "루체", "오브젝트"];
BAGS.forEach(([t, f, p], i) => COLOURS.forEach(([cn, c], j) => { if ((i * 2 + j) % 4) return; const b = BAGBRANDS[(i + j) % 5]; add({ cat: "bags", brand: b, name: `${b} ${t} ${cn}`, form: f, price: won(p, hashOf(t + cn), 0.3), kind: "goods", color: c, color2: "#c9a24a", ink: "#ffffff", desc: ["소가죽", "비건 레더", "나일론", "캔버스"][(i + j) % 4] }); }));
const FRAMES: [string, number][] = [["보잉", 159000], ["캣아이", 149000], ["라운드", 129000], ["스퀘어", 139000], ["오버사이즈", 169000], ["스포츠 랩", 119000]];
const LENS: [string, string][] = [["스모크", "#262a30"], ["브라운", "#5a3a22"], ["그린", "#2f4a34"], ["미러 블루", "#2a5c9a"], ["로즈", "#a85a6a"]];
const EYEBRANDS = ["옵티카", "솔리스", "아이리스", "클리어뷰"];
FRAMES.forEach(([t, p], i) => LENS.forEach(([ln, lc], j) => { const fc = ["#1a1a1a", "#c9a24a", "#7a4a2a", "#d8d8d8", "#2b3a55"][(i + j) % 5], b = EYEBRANDS[(i + j) % 4]; add({ cat: "sunglasses", brand: b, name: `${b} ${t} 선글라스 ${ln}`, form: "sunglasses", price: won(p, hashOf(t + ln), 0.3), kind: "goods", color: fc, color2: lc, ink: "#ffffff", desc: "UV400 편광" }); }));
["뿔테 라운드", "메탈 스퀘어", "투명 뿔테", "하금테", "티타늄 무테", "볼드 사각"].forEach((t, i) => ["블랙", "골드", "실버", "브라운"].forEach((cn, j) => { const b = EYEBRANDS[(i + j) % 4]; add({ cat: "glasses", brand: b, name: `${b} ${t} 안경테 ${cn}`, form: "glasses", price: won(119000, hashOf(t + cn), 0.4), kind: "goods", color: ["#1a1a1a", "#c9a24a", "#c8c8cc", "#6b4a33"][j], color2: "#dfe9ef", ink: "#fff", desc: "기본 렌즈 포함" }); }));
["클래식 가죽 시계", "메탈 크로노그래프", "스마트 밴드", "다이버 워치", "미니 드레스 워치", "디지털 손목시계"].forEach((t, i) => ["블랙", "실버", "골드", "네이비"].forEach((cn, j) => add({ cat: "watch", brand: ["크로노스", "티크톡", "아워글래스"][(i + j) % 3], name: `${t} ${cn}`, form: "watch", price: won([189000, 349000, 79000, 299000, 159000, 49000][i], hashOf(t + cn), 0.3), kind: "goods", color: ["#1a1a1a", "#c8c8cc", "#c9a24a", "#1f2f4f"][j], color2: i % 2 ? "#e8e8e8" : "#6b4a33", ink: "#fff", desc: ["가죽 스트랩", "스테인리스", "실리콘"][(i + j) % 3] })));
["실버 링", "골드 링", "진주 목걸이", "하트 펜던트 목걸이", "큐빅 귀걸이", "링 귀걸이", "체인 팔찌", "레이어드 목걸이", "이니셜 펜던트", "진주 귀걸이"].forEach((t, i) => add({ cat: "jewelry", brand: ["벨라", "루나", "오로"][i % 3], name: t, form: /링$/.test(t) ? "ring" : "necklace", price: won([59000, 129000, 89000, 69000, 39000, 49000, 59000, 79000, 69000, 45000][i], hashOf(t), 0.3), kind: "goods", color: /골드|하트|이니셜/.test(t) ? "#d4af37" : /진주/.test(t) ? "#f3efe6" : "#c8c8cc", color2: "#1f1f24", ink: "#fff", desc: /골드/.test(t) ? "14K" : "925 실버" }));
["볼캡", "버킷햇", "비니", "스냅백", "페도라"].forEach((t, i) => COLOURS.slice(0, 8).forEach(([cn, c], j) => { if ((i + j) % 2) return; add({ cat: "hats", brand: LABELS[(i + j) % LABELS.length], name: `${t} ${cn}`, form: "cap", price: won([29000, 35000, 25000, 39000, 59000][i], hashOf(t + cn)), kind: "goods", color: c, color2: VIVID[j % VIVID.length], ink: "#fff", desc: "프리 사이즈" }); }));

// ---- books & stationery ----
const GENRES: [string, string[], string[]][] = [
  ["소설", ["달빛", "여름", "마지막", "푸른", "잃어버린", "기억의", "작은", "밤의", "고요한", "두 번째"], ["정원", "기차", "편지", "서점", "섬", "도시", "약속", "계절", "항해", "온도"]],
  ["에세이", ["느리게", "오늘도", "괜찮아,", "가끔은", "다정한", "혼자서도", "천천히", "소란한"], ["걷는 법", "나에게", "하루", "마음", "산책", "위로", "일상", "식탁"]],
  ["경제경영", ["부의", "돈의", "투자의", "시장의", "미래", "숫자로 읽는", "부자들의", "처음 배우는"], ["원칙", "심리학", "흐름", "공식", "지도", "습관", "주식", "경제학"]],
  ["자기계발", ["아주 작은", "몰입의", "생각의", "결국 해내는", "단단한", "10분"], ["습관", "기술", "힘", "사람들", "루틴", "대화법"]],
  ["과학", ["우주의", "시간의", "생명의", "빛의", "뇌의", "바다의"], ["역사", "비밀", "탄생", "구조", "모험", "이야기"]],
  ["여행", ["제주", "교토", "파리", "리스본", "강릉", "치앙마이"], ["한 달 살기", "골목 산책", "여행 노트", "100곳", "맛집 지도"]],
  ["요리", ["매일", "10분", "집밥", "엄마의", "비건", "도시락"], ["레시피", "반찬", "한 그릇", "베이킹", "식탁"]],
  ["만화", ["용사", "고양이", "학교", "던전", "별빛"], ["모험기 1", "일상 2", "탐정단 3", "레시피 4", "원정대 5"]],
  ["시집", ["바람이", "너에게", "꽃이", "비 오는 날"], ["부는 쪽으로", "가는 길", "피는 소리", "읽는 시"]],
  ["그림책", ["곰돌이", "구름", "토끼의", "꼬마"], ["산책", "여행", "생일", "친구"]],
];
const AUTHORS = ["김하늘", "이서윤", "박도현", "최지우", "정민재", "한소희", "오세린", "윤태오", "강예린", "서준호", "문채원", "임지훈"];
const PUBLISHERS = ["푸른숲길", "열린책방", "오후출판", "새벽서가", "다온북스"];
GENRES.forEach(([g, A, B], gi) => A.forEach((a, i) => B.forEach((b, j) => {
  if ((i * 7 + j * 3 + gi) % 4) return;
  const title = `${a} ${b}`, h = hashOf(title);
  add({ cat: "books", brand: PUBLISHERS[h % 5], name: `『${title}』`, form: "book", price: won(g === "만화" ? 6500 : g === "그림책" ? 13000 : 16800, h, 0.3), kind: "goods", color: [...DEEP, ...VIVID, ...PASTEL][h % 36], color2: [...PASTEL, ...VIVID][(h >> 4) % 26], ink: h % 3 ? "#ffffff" : "#1c1c1c", desc: `${g} · ${AUTHORS[h % AUTHORS.length]} 지음` });
})));
const NOTES: [string, Form, number, string][] = [["A5 줄노트", "notebook", 3500, "80매"], ["모눈 노트", "notebook", 3800, "80매"], ["무지 스케치북", "notebook", 5500, "50매"], ["스프링 노트", "notebook", 2500, "60매"], ["하드커버 다이어리", "notebook", 15000, "2027"], ["위클리 플래너", "notebook", 12000, "만년형"], ["포켓 수첩", "notebook", 2000, "48매"]];
const PAPER = ["페이퍼문", "노트앤노트", "잉크웰", "모닝페이지"];
NOTES.forEach(([t, f, p, d], i) => ["도트", "스트라이프", "플라워", "체크", "솔리드", "지오메트릭"].forEach((pat, j) => add({ cat: "stationery", brand: PAPER[(i + j) % 4], name: `${PAPER[(i + j) % 4]} ${t} (${pat})`, form: f, price: won(p, hashOf(t + pat), 0.2), kind: "goods", color: [...PASTEL, ...VIVID][(i * 6 + j) % 26], color2: [...DEEP][(i + j) % DEEP.length], ink: "#ffffff", desc: `${d} · ${pat}` })));
["0.5 볼펜 3색", "젤 잉크펜", "형광펜 5색", "만년필", "샤프 0.5", "색연필 24색", "네임펜", "붓펜"].forEach((t, i) => add({ cat: "stationery", brand: PAPER[i % 4], name: t, form: "pen", price: won([3500, 2500, 6000, 39000, 4500, 12000, 1500, 3000][i], hashOf(t)), kind: "goods", color: VIVID[i * 2 % VIVID.length], color2: "#1a1a1a", ink: "#fff", desc: "필기구" }));
["마스킹 테이프", "스티커 팩", "포스트잇", "가죽 필통", "북마크 세트", "엽서 세트", "데스크 매트", "연필꽂이"].forEach((t, i) => add({ cat: "stationery", brand: PAPER[(i + 1) % 4], name: t, form: i === 3 ? "wallet" : "box", price: won([2500, 3000, 2000, 18000, 4000, 6000, 15000, 9000][i], hashOf(t)), kind: "goods", color: PASTEL[i % PASTEL.length], color2: VIVID[(i * 3) % VIVID.length], ink: "#2a2a2a", desc: "문구 소품" }));

// ---- digital ----
const TECH = ["노바", "픽셀원", "에코사운드", "볼트", "루멘"];
const DEVICES: [string, number, string][] = [["스마트폰 S", 1199000, "256GB"], ["폴더블폰 Z", 1999000, "512GB"], ["태블릿 10", 699000, "Wi-Fi 128GB"], ["울트라북 14", 1590000, "16GB/512GB"], ["무선 이어폰", 189000, "노이즈캔슬링"], ["오버이어 헤드폰", 329000, "블루투스 5.3"], ["스마트워치", 349000, "44mm"], ["블루투스 스피커", 129000, "방수 IP67"], ["보조배터리 2만", 39000, "20000mAh"], ["고속 충전기", 29000, "65W"], ["무선 마우스", 39000, "저소음"], ["기계식 키보드", 129000, "적축"], ["미러리스 카메라", 1290000, "24MP"], ["액션캠", 449000, "4K60"], ["게임 컨트롤러", 79000, "무선"], ["전자책 리더", 219000, "6인치"]];
DEVICES.forEach(([t, p, d], i) => ["블랙", "실버", "블루"].forEach((cn, j) => { if (j && i % 2) return; const b = TECH[(i + j) % 5]; add({ cat: "electronics", brand: b, name: `${b} ${t} ${cn}`, form: i < 4 || i === 12 || i === 15 ? "device" : "box", price: won(p, hashOf(t + cn), 0.1), kind: "goods", color: ["#15171a", "#e9eaec", "#1f4f8f"][j], color2: VIVID[(i * 5) % VIVID.length], ink: j === 1 ? "#111" : "#fff", desc: d }); }));
["USB-C 케이블", "휴대폰 케이스", "강화유리 필름", "스마트폰 거치대", "멀티탭", "LED 스탠드", "웹캠", "SD 카드 128GB"].forEach((t, i) => add({ cat: "electronics", brand: TECH[i % 5], name: `${TECH[i % 5]} ${t}`, form: "box", price: won([12000, 25000, 15000, 19000, 22000, 49000, 69000, 29000][i], hashOf(t)), kind: "goods", color: ["#f4f4f4", "#1a1a1a"][i % 2], color2: VIVID[(i * 3 + 1) % VIVID.length], ink: i % 2 ? "#fff" : "#111", desc: "액세서리" }));

// ---- food & drink ----
const SNACKS: [string, string][] = [["바삭칩 오리지널", "#f2c230"], ["바삭칩 사워크림", "#3aa76d"], ["새우스낵", "#e94b3c"], ["양파링", "#7a3fb0"], ["초코 칩 쿠키", "#6b3f2a"], ["버터 쿠키", "#e8c07a"], ["초코바", "#3b2416"], ["딸기 젤리", "#e8436f"], ["포도 젤리", "#6a2c91"], ["카라멜 팝콘", "#d98f2b"], ["옥수수 스낵", "#f6d743"], ["매운 떡볶이 스낵", "#d7261e"], ["감자 스틱", "#c9302c"], ["초코 파이", "#8a4a2a"], ["허니 버터칩", "#f2b13c"], ["김 스낵", "#2e5d32"], ["밀크 초콜릿", "#5a2e1a"], ["다크 초콜릿 72%", "#2a160d"], ["민트 캔디", "#7fd6c2"], ["과일 사탕", "#ff7a59"], ["자일리톨 껌", "#3bb273"], ["웨하스", "#f0a5b8"], ["프레첼", "#b06a2c"], ["크래커", "#e0b25a"]];
const SNACKBRANDS = ["오리온스", "해피팜", "롤리팝", "크런치", "스윗데이"];
SNACKS.forEach(([t, c], i) => add({ cat: "snack", brand: SNACKBRANDS[i % 5], name: `${SNACKBRANDS[i % 5]} ${t}`, form: /초콜릿|껌|캔디|사탕|파이|웨하스|쿠키|크래커/.test(t) ? "box" : "pouch", price: won(1700, hashOf(t), 0.8), kind: "food", how: /젤리|파이|초콜릿|캔디|사탕/.test(t) ? "soft" : "crunch", color: c, color2: VIVID[(i * 7) % VIVID.length], ink: "#ffffff", desc: `${60 + (i % 5) * 20}g` }));
const DRINKS: [string, Form, string, number, ProductHow][] = [["콜라", "can", "#c8141e", 1900, "can"], ["제로 콜라", "can", "#1a1a1a", 1900, "can"], ["사이다", "can", "#1f9a4a", 1900, "can"], ["오렌지 탄산", "can", "#f57c00", 1800, "can"], ["에너지 드링크", "can", "#2d2d7a", 2500, "can"], ["캔커피 라떼", "can", "#8b5a3c", 1500, "can"], ["생수 500ml", "pet", "#9fd8ff", 950, "bottle"], ["탄산수 레몬", "pet", "#c6e66e", 1600, "bottle"], ["이온 음료", "pet", "#3f8fe0", 1800, "bottle"], ["녹차", "pet", "#5d8f3a", 1600, "bottle"], ["옥수수수염차", "pet", "#c9a34a", 1700, "bottle"], ["오렌지 주스", "pet", "#f6a623", 2200, "bottle"], ["포도 주스", "pet", "#6a2c70", 2200, "bottle"], ["콤부차", "pet", "#e7a977", 3200, "bottle"], ["바나나 우유", "carton", "#f6d64a", 1700, "carton"], ["초코 우유", "carton", "#6b3f2a", 1500, "carton"], ["딸기 우유", "carton", "#f48fb1", 1500, "carton"], ["흰 우유 1L", "carton", "#e8f1fb", 2900, "carton"], ["두유", "carton", "#e9d8b4", 1200, "carton"], ["요구르트", "carton", "#ff8fa3", 1300, "carton"], ["아이스티 복숭아", "carton", "#f7a072", 1400, "carton"], ["식혜", "can", "#f0e2b6", 1500, "can"]];
type ProductHow = NonNullable<Product["how"]>;
const DRINKBRANDS = ["스파클", "프레시데이", "밀키웨이", "그린필드"];
DRINKS.forEach(([t, f, c, p, how], i) => add({ cat: "drink", brand: DRINKBRANDS[i % 4], name: t, form: f, price: p, kind: "drink", how, color: c, color2: "#ffffff", ink: luma(c) > 0.6 ? "#1a1a1a" : "#ffffff", desc: f === "can" ? "355ml" : f === "carton" ? "200ml" : "500ml" }));
const FRESH: [string, string, number, string][] = [["사과 1.5kg", "#d62828", 12900, "부사"], ["배 2입", "#e5c76b", 9900, "신고"], ["제주 감귤 1kg", "#f77f00", 7900, ""], ["바나나 한 송이", "#f6d64a", 4500, "필리핀"], ["딸기 500g", "#e63946", 12900, "설향"], ["샤인머스캣", "#9acd32", 15900, "1송이"], ["방울토마토 500g", "#e5383b", 6900, ""], ["블루베리 200g", "#3d3b8e", 8900, "냉장"], ["양파 1.5kg", "#d4a373", 4900, ""], ["당근 3입", "#f4842d", 2900, ""], ["감자 1kg", "#c9a26b", 4500, ""], ["대파 1단", "#6fae3e", 2900, ""], ["애호박", "#8fbc5a", 1500, ""], ["브로콜리", "#3f7d20", 2500, ""], ["계란 30구", "#f2e2c2", 8900, "1등급"], ["한우 등심 300g", "#a4161a", 39900, "1++"], ["삼겹살 600g", "#e9a3a3", 15900, "국내산"], ["닭가슴살 1kg", "#f3c5b2", 9900, ""], ["고등어 2손", "#6d8aa3", 8900, ""], ["두부 2모", "#f8f5ec", 3500, "국산콩"], ["수박 1통", "#2e7d32", 24900, "7kg"], ["복숭아 4입", "#f7b39b", 13900, ""]];
FRESH.forEach(([t, c, p, d], i) => add({ cat: "fresh", brand: "신선마켓", name: t, form: /고기|삼겹|등심|닭|고등어|두부|계란/.test(t) ? "tray" : "fruit", price: won(p, i, 0.1), kind: /바나나|딸기|샤인|토마토|블루베리|복숭아|사과|귤|배/.test(t) ? "food" : "goods", how: "soft", color: c, color2: "#ffffff", ink: "#1a1a1a", desc: d || "오늘 입고" }));
const GROCERY: [string, Form, string, number][] = [["얼큰 라면 5입", "pouch", "#d62828", 4500], ["짜장 라면 4입", "pouch", "#2b2b2b", 5200], ["컵라면 6입", "box", "#e63946", 6900], ["즉석밥 6입", "box", "#f4f1ec", 7900], ["참치캔 3입", "can", "#1d4e89", 8900], ["스팸 200g", "can", "#1f3f8f", 4900], ["조미김 10봉", "pouch", "#1b4332", 5900], ["진간장 1.8L", "pet", "#3b1f0f", 7900], ["고추장 1kg", "jar", "#b5161e", 9900], ["된장 1kg", "jar", "#8a5a2b", 8900], ["카놀라유 1.8L", "pet", "#f2c94c", 8500], ["백설탕 1kg", "pouch", "#f8f8f8", 2900], ["천일염 1kg", "pouch", "#e1ecf2", 3500], ["밀가루 1kg", "pouch", "#f4eadc", 2500], ["시리얼", "box", "#ff9f1c", 6500], ["커피믹스 100T", "box", "#c8102e", 15900], ["원두 커피 200g", "pouch", "#3b2416", 12900], ["녹차 티백", "box", "#5d8f3a", 4900], ["딸기잼", "jar", "#c1121f", 4500], ["땅콩버터", "jar", "#a66a2c", 6900], ["파스타면", "box", "#1d3557", 3500], ["토마토 소스", "jar", "#c1121f", 4900], ["냉동 만두", "pouch", "#e9c46a", 8900], ["냉동 피자", "box", "#e76f51", 9900]];
GROCERY.forEach(([t, f, c, p], i) => add({ cat: "grocery", brand: ["오뚜기마을", "한끼", "맛있는집", "해피팜"][i % 4], name: t, form: f, price: won(p, i, 0.1), kind: "goods", color: c, color2: VIVID[(i * 3) % VIVID.length], ink: luma(c) > 0.6 ? "#1a1a1a" : "#ffffff", desc: "가공식품" }));
const HOUSE: [string, Form, string, number][] = [["3겹 화장지 30롤", "box", "#ffffff", 18900], ["키친타월 6롤", "box", "#f4f9ff", 6900], ["액체 세제 3L", "pet", "#4361ee", 12900], ["섬유유연제 2L", "pet", "#b5838d", 9900], ["주방세제 1L", "pump", "#7ae582", 4900], ["칫솔 4입", "box", "#48cae4", 5900], ["치약 3입", "tube", "#e63946", 6900], ["물티슈 100매", "pouch", "#cde7f0", 2500], ["고무장갑", "pouch", "#ffb703", 2000], ["수세미 5입", "pouch", "#90be6d", 2500], ["종량제 봉투 20L", "pouch", "#9bc1bc", 5000], ["AA 건전지 8입", "box", "#1d1d1d", 7900], ["섬유 탈취제", "bottle", "#a2d2ff", 6900], ["욕실 세정제", "bottle", "#00b4d8", 5900], ["방향제", "jar", "#cdb4db", 7900], ["지퍼백", "box", "#e9f5db", 3900]];
HOUSE.forEach(([t, f, c, p], i) => add({ cat: "household", brand: ["클린하우스", "데일리홈", "퓨어"][i % 3], name: t, form: f, price: won(p, i, 0.1), kind: "goods", color: c, color2: VIVID[(i * 5) % VIVID.length], ink: luma(c) > 0.6 ? "#1a1a1a" : "#ffffff", desc: "생활용품" }));
const KITCHEN: [string, Form, number][] = [["세라믹 머그컵", "mug", 9900], ["진공 텀블러", "pet", 24900], ["원형 접시 세트", "box", 29900], ["수저 세트", "box", 19900], ["논스틱 프라이팬", "box", 39900], ["스테인리스 냄비", "box", 49900], ["유리 밀폐용기", "box", 19900], ["커피 드리퍼", "mug", 15900]];
KITCHEN.forEach(([t, f, p], i) => ["화이트", "블랙", "민트"].forEach((cn, j) => add({ cat: "kitchen", brand: ["키친랩", "모던테이블"][(i + j) % 2], name: `${t} ${cn}`, form: f, price: won(p, hashOf(t + cn), 0.2), kind: "goods", color: ["#f4f4f1", "#1c1c1e", "#a8dccb"][j], color2: "#c9a24a", ink: j === 1 ? "#fff" : "#222", desc: "주방용품" })));
const DECO: [string, Form, number][] = [["소이 캔들", "jar", 22000], ["리드 디퓨저", "perfume", 29000], ["벨벳 쿠션", "box", 25000], ["우드 액자", "box", 15000], ["미니 화분", "plant", 12000], ["무드등", "mug", 35000], ["러그", "box", 59000], ["탁상 시계", "box", 29000]];
DECO.forEach(([t, f, p], i) => ["베이지", "세이지", "테라코타"].forEach((cn, j) => add({ cat: "deco", brand: ["홈어라운드", "리빙노트"][(i + j) % 2], name: `${t} ${cn}`, form: f, price: won(p, hashOf(t + cn), 0.2), kind: "goods", color: ["#d8c4a4", "#9caf88", "#c66b3d"][j], color2: "#f4efe6", ink: "#222", desc: "홈데코" })));
["조립 블록 세트", "곰인형", "1000피스 퍼즐", "보드게임", "RC 자동차", "히어로 피규어", "슬라임 키트", "큐브 퍼즐", "미니카 5종", "색칠북"].forEach((t, i) => add({ cat: "toys", brand: ["토이랜드", "플레이킹"][i % 2], name: t, form: i === 1 ? "toy" : "box", price: won([39000, 29000, 19000, 32000, 49000, 25000, 9000, 12000, 15000, 6000][i], hashOf(t)), kind: "goods", color: VIVID[(i * 3) % VIVID.length], color2: VIVID[(i * 3 + 5) % VIVID.length], ink: "#fff", desc: "장난감" }));
["요가 매트", "덤벨 3kg", "줄넘기", "축구공", "농구공", "테니스 라켓", "배드민턴 세트", "스포츠 물병", "헤어밴드", "러닝 양말 3족"].forEach((t, i) => add({ cat: "sports", brand: ["액티브", "핏업"][i % 2], name: t, form: /공$/.test(t) ? "ball" : /물병/.test(t) ? "pet" : "box", price: won([29000, 19000, 9000, 35000, 39000, 89000, 25000, 15000, 9000, 12000][i], hashOf(t)), kind: "goods", color: VIVID[(i * 5 + 2) % VIVID.length], color2: "#ffffff", ink: "#fff", desc: "스포츠" }));
const BREAD: [string, Form, string, number][] = [["크루아상", "bread", "#d9a35f", 3500], ["소금빵", "bread", "#e3b26e", 3200], ["크림빵", "bread", "#f4d79a", 2800], ["단팥빵", "bread", "#a0522d", 2500], ["식빵", "bread", "#e9c58d", 4500], ["바게트", "bread", "#c98a4b", 4000], ["베이글", "bread", "#d9a35f", 3000], ["치즈 케이크", "cake", "#ffe9a8", 6500], ["딸기 생크림 케이크", "cake", "#ffd1dc", 7000], ["초코 케이크", "cake", "#5a2e1a", 6800], ["티라미수", "cake", "#a47148", 6500], ["마카롱", "cake", "#ffb3d1", 2800], ["도넛", "bread", "#ff9f9f", 2200], ["에그타르트", "cake", "#f2c14e", 3000], ["스콘", "bread", "#d4a373", 3500], ["마들렌", "bread", "#e9c46a", 2500]];
BREAD.forEach(([t, f, c, p], i) => add({ cat: /케이크|티라미수|마카롱|타르트/.test(t) ? "dessert" : "bakery", brand: "오븐하우스", name: t, form: f, price: p, kind: "food", how: "soft", color: c, color2: "#ffffff", ink: "#3a2412", desc: i < 7 ? "오늘 구운 빵" : "디저트" }));
const COFFEE: [string, string, number][] = [["아메리카노", "#3b2416", 4500], ["카페 라테", "#c8a27a", 5000], ["바닐라 라테", "#e6cfa8", 5500], ["카푸치노", "#b08968", 5000], ["콜드브루", "#2b1a10", 5300], ["말차 라테", "#7a9a3a", 5800], ["레몬 에이드", "#f6e05e", 5500], ["자몽 에이드", "#f28482", 5800], ["얼그레이 티", "#9c6b3c", 4800], ["딸기 스무디", "#ff6f91", 6000], ["망고 스무디", "#ffb703", 6000], ["핫초코", "#6b3f2a", 5000]];
COFFEE.forEach(([t, c, p]) => add({ cat: "coffee", brand: "카페", name: t, form: "cup", price: p, kind: "drink", how: "cup", color: c, color2: "#ffffff", ink: "#3a2412", desc: "Tall 355ml" }));
const MEALS: [string, string, number][] = [["김치찌개", "#c0392b", 9000], ["된장찌개", "#a66a2c", 9000], ["비빔밥", "#e67e22", 9500], ["불고기 정식", "#7f3b1f", 12000], ["칼국수", "#f3e5ab", 8500], ["돈가스", "#c68642", 10000], ["제육볶음", "#c1440e", 10000], ["떡볶이", "#e74c3c", 5000], ["김밥 한 줄", "#2e7d32", 3500], ["라면", "#e63946", 4500], ["냉면", "#8d99ae", 9000], ["짜장면", "#2b2b2b", 7000], ["짬뽕", "#c0392b", 8000], ["삼각김밥", "#f4f4f1", 1300], ["도시락", "#d9534f", 4900], ["샌드위치", "#f0d9a8", 3900]];
MEALS.forEach(([t, c, p], i) => add({ cat: "meal", brand: i >= 13 ? "편의점" : "식당", name: t, form: i >= 13 ? "box" : "tray", price: p, kind: "food", how: "soft", color: c, color2: "#ffffff", ink: "#1a1a1a", desc: i >= 13 ? "간편식" : "1인분" }));
const HEALTH: [string, Form, string, number][] = [["종합 감기약", "box", "#3a7bd5", 4000], ["해열 진통제", "box", "#e63946", 3500], ["소화제", "box", "#2a9d8f", 3000], ["밴드 30매", "box", "#f4c7a1", 3000], ["파스 5매", "box", "#e8e8e8", 5000], ["인공눈물", "box", "#90e0ef", 6000], ["비타민C 1000", "jar", "#ff9f1c", 15000], ["유산균 30포", "box", "#7bdff2", 25000], ["오메가3", "jar", "#f9c74f", 22000], ["피로회복 드링크", "pet", "#7a3e12", 1000], ["숙취해소 음료", "pet", "#c8a24a", 5000], ["보건용 마스크 5매", "pouch", "#ffffff", 3000], ["손소독제", "pump", "#bde0fe", 4000], ["립 케어 연고", "tube", "#ffafcc", 5000]];
HEALTH.forEach(([t, f, c, p], i) => add({ cat: "health", brand: ["한빛제약", "메디팜", "케어랩"][i % 3], name: t, form: f, price: p, kind: /드링크|음료/.test(t) ? "drink" : "goods", how: /드링크|음료/.test(t) ? "bottle" : undefined, color: c, color2: "#ffffff", ink: luma(c) > 0.6 ? "#1a1a1a" : "#ffffff", desc: "약국" }));

function luma(c: string) { const v = parseInt(c.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; }

export const PRODUCTS: readonly Product[] = out;
const byId = new Map(out.map(p => [p.id, p]));
export const productById = (id: string) => byId.get(id);

/** what each kind of counter sells (by category) */
export type Store = "convenience" | "cafe" | "pharmacy" | "food" | "retail" | "cosmetics" | "clothing" | "books" | "bakery" | "electronics" | "mart" | "department" | "eyewear" | "shoes" | "bags" | "variety" | "sports";
export const STORE_CATS: Record<Store, Cat[]> = {
  convenience: ["drink", "snack", "meal", "grocery", "household", "health", "stationery"],
  cafe: ["coffee", "dessert", "bakery"], pharmacy: ["health", "skincare"], food: ["meal", "drink"],
  retail: ["stationery", "deco", "kitchen", "toys", "household"], variety: ["stationery", "deco", "kitchen", "household", "toys", "snack"],
  cosmetics: ["makeup", "skincare", "perfume", "hair"], clothing: ["tops", "bottoms", "outer", "hats", "bags", "shoes"],
  books: ["books", "stationery"], bakery: ["bakery", "dessert", "coffee"], electronics: ["electronics"],
  mart: ["fresh", "grocery", "snack", "drink", "household", "kitchen"],
  department: ["makeup", "skincare", "perfume", "tops", "outer", "bags", "shoes", "sunglasses", "watch", "jewelry", "deco", "kitchen"],
  eyewear: ["glasses", "sunglasses"], shoes: ["shoes"], bags: ["bags", "jewelry", "watch"], sports: ["sports", "shoes", "tops", "hats"],
};
export function storeItems(store: Store): Product[] { const cats = new Set(STORE_CATS[store]); return out.filter(p => cats.has(p.cat)); }
/** a store's goods for one display: of the given categories (or all of its own), a stable pick */
export function displayPick(store: Store, cats: Cat[] | null, count: number, seed: number): Product[] {
  const want = new Set(cats ?? STORE_CATS[store]), pool = out.filter(p => want.has(p.cat));
  if (!pool.length) return [];
  const res: Product[] = [];
  for (let i = 0; i < count; i++) res.push(pool[(Math.imul(seed + i * 7919, 2654435761) >>> 0) % pool.length]);
  return res;
}
