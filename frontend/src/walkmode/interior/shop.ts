/* What a building's counters sell (for play money — wallet.ts): a convenience store's drinks and
 * snacks, a café's coffee and cake, a pharmacy's tonics, a restaurant's dishes, a shop's goods.
 * Drinks and food are had there and then (the hand's drink animation, its sounds); goods go in
 * the bag. Prices are plausible Korean prices; the names are generic, not brands. */

export type ShopKind = "convenience" | "cafe" | "pharmacy" | "food" | "retail" | "cosmetics" | "clothing" | "books" | "bakery" | "electronics" | "mart";
export interface ShopItem { id: string; name: string; price: number; kind: "drink" | "food" | "goods"; how?: "can" | "bottle" | "cup" | "carton" | "soft" | "crunch"; color: string }

const item = (kind: ShopItem["kind"], how: ShopItem["how"], rows: [string, string, number, string][]): ShopItem[] =>
  rows.map(([id, name, price, color]) => ({ id, name, price, kind, how, color }));

export const SHOP_ITEMS: Record<ShopKind, ShopItem[]> = {
  convenience: [
    ...item("drink", "can", [["c-cola", "콜라 355ml", 1900, "#c8141e"], ["c-cider", "사이다 355ml", 1900, "#1f9a4a"], ["c-energy", "에너지 드링크", 2500, "#2d2d7a"]]),
    ...item("drink", "bottle", [["c-water", "생수 500ml", 950, "#9fd8ff"], ["c-ion", "이온 음료", 1800, "#3f8fe0"], ["c-tea", "옥수수수염차", 1700, "#c9a34a"]]),
    ...item("drink", "carton", [["c-banana", "바나나 우유", 1700, "#f6d64a"], ["c-choco", "초코 우유", 1500, "#6b3f2a"]]),
    ...item("food", "soft", [["c-kimbap", "삼각김밥", 1300, "#f4f4f1"], ["c-sand", "샌드위치", 2900, "#f0d9a8"], ["c-dosirak", "도시락", 4900, "#d9534f"], ["c-ice", "아이스크림", 1500, "#ffd1dc"]]),
    ...item("food", "crunch", [["c-chips", "감자칩", 1700, "#ffcc33"], ["c-cookie", "초코 쿠키", 1500, "#7b4a2e"]]),
    ...item("goods", undefined, [["c-umbrella", "비닐우산", 6000, "#cfe8ff"], ["c-battery", "보조배터리", 15000, "#333a44"], ["c-mask", "마스크 5매", 3000, "#ffffff"]]),
  ],
  cafe: [
    ...item("drink", "cup", [["f-americano", "아메리카노", 4500, "#3b2416"], ["f-latte", "카페 라테", 5000, "#c8a27a"], ["f-vanilla", "바닐라 라테", 5500, "#e6cfa8"], ["f-ade", "레몬 에이드", 5500, "#f6e05e"], ["f-tea", "얼그레이 티", 4800, "#9c6b3c"], ["f-smoothie", "딸기 스무디", 6000, "#ff6f91"]]),
    ...item("food", "soft", [["f-cake", "치즈 케이크", 6500, "#ffe9a8"], ["f-bagel", "크림치즈 베이글", 4500, "#d9a35f"], ["f-macaron", "마카롱", 2800, "#ffb3d1"]]),
  ],
  pharmacy: [
    ...item("drink", "bottle", [["p-tonic", "피로회복 드링크", 1000, "#7a3e12"], ["p-vitamin", "비타민 음료", 1200, "#ff9f1c"], ["p-ginger", "숙취해소 음료", 5000, "#c8a24a"]]),
    ...item("goods", undefined, [["p-band", "밴드", 3000, "#f4c7a1"], ["p-patch", "파스", 5000, "#e8e8e8"], ["p-cold", "종합 감기약", 4000, "#3a7bd5"], ["p-mask", "보건용 마스크", 2000, "#ffffff"]]),
  ],
  food: [
    ...item("food", "soft", [["r-kimchi", "김치찌개", 9000, "#c0392b"], ["r-bibim", "비빔밥", 9500, "#e67e22"], ["r-noodle", "칼국수", 8500, "#f3e5ab"], ["r-cutlet", "돈가스", 10000, "#c68642"], ["r-tteok", "떡볶이", 5000, "#e74c3c"], ["r-gimbap", "김밥 한 줄", 3500, "#2e7d32"]]),
    ...item("drink", "cup", [["r-sikhye", "식혜", 2000, "#f0e2b6"], ["r-soda", "탄산음료", 2000, "#c8141e"]]),
  ],
  cosmetics: [
    ...item("goods", undefined, [["k-lip", "립스틱", 15000, "#c2185b"], ["k-cream", "수분 크림", 22000, "#f8e1e7"], ["k-sun", "선크림", 18000, "#fff3c4"], ["k-mask", "마스크팩 10매", 10000, "#bde0fe"], ["k-perfume", "향수", 59000, "#d4a5ff"], ["k-hand", "핸드크림", 8000, "#ffe5d9"], ["k-shampoo", "샴푸", 12000, "#a3d9a5"]]),
    ...item("drink", "bottle", [["k-vita", "비타민 워터", 2000, "#ffb703"]]),
  ],
  clothing: [
    ...item("goods", undefined, [["w-tee", "면 티셔츠", 19900, "#f1f1f1"], ["w-hood", "후드티", 49900, "#3d405b"], ["w-jean", "청바지", 59900, "#264653"], ["w-coat", "코트", 159000, "#8d6e63"], ["w-socks", "양말 3켤레", 9900, "#e76f51"], ["w-cap", "볼캡", 29000, "#1d3557"], ["w-shoe", "운동화", 89000, "#ffffff"]]),
  ],
  books: [
    ...item("goods", undefined, [["b-novel", "베스트셀러 소설", 16800, "#e63946"], ["b-essay", "에세이", 15000, "#f1faee"], ["b-comic", "만화책", 6000, "#ffb703"], ["b-travel", "여행 가이드북", 19800, "#2a9d8f"], ["b-cook", "요리책", 22000, "#f4a261"], ["b-note", "다이어리", 13000, "#264653"]]),
    ...item("drink", "cup", [["b-coffee", "북카페 라테", 4800, "#c8a27a"]]),
  ],
  bakery: [
    ...item("food", "soft", [["y-croissant", "크루아상", 3500, "#d9a35f"], ["y-cream", "크림빵", 2800, "#f4d79a"], ["y-red", "단팥빵", 2500, "#a0522d"], ["y-sand", "샌드위치", 5900, "#f0d9a8"], ["y-cake", "조각 케이크", 6500, "#ffe9a8"], ["y-donut", "도넛", 2200, "#ff9f9f"]]),
    ...item("drink", "carton", [["y-milk", "우유", 1800, "#ffffff"]]), ...item("drink", "cup", [["y-latte", "카페 라테", 4500, "#c8a27a"]]),
  ],
  electronics: [
    ...item("goods", undefined, [["e-ear", "무선 이어폰", 159000, "#f1f1f1"], ["e-case", "휴대폰 케이스", 25000, "#264653"], ["e-cable", "충전 케이블", 15000, "#ffffff"], ["e-batt", "보조배터리", 39000, "#333a44"], ["e-watch", "스마트워치", 299000, "#111111"], ["e-mouse", "무선 마우스", 29000, "#555555"]]),
  ],
  mart: [
    ...item("drink", "can", [["m-cola", "콜라 6캔", 6900, "#c8141e"], ["m-beer", "맥주 4캔", 11000, "#d4a017"]]),
    ...item("drink", "bottle", [["m-water", "생수 2L", 1200, "#9fd8ff"], ["m-juice", "오렌지 주스 1L", 4500, "#f6a623"]]),
    ...item("drink", "carton", [["m-milk", "우유 1L", 2900, "#ffffff"]]),
    ...item("food", "crunch", [["m-apple", "사과 한 봉", 9900, "#d62828"], ["m-chips", "과자 묶음", 5900, "#ffcc33"]]),
    ...item("food", "soft", [["m-banana", "바나나 한 송이", 4500, "#f6d64a"], ["m-kimbap", "김밥", 3500, "#2e7d32"], ["m-ramen", "컵라면 4개", 5600, "#e63946"]]),
    ...item("goods", undefined, [["m-tissue", "화장지 30롤", 18900, "#ffffff"], ["m-detergent", "세제", 12900, "#4361ee"], ["m-rice", "쌀 10kg", 32000, "#f1e3c8"]]),
  ],
  retail: [
    ...item("goods", undefined, [["s-pen", "볼펜 세트", 3500, "#2f6fd6"], ["s-note", "노트", 2500, "#f2c94c"], ["s-tumbler", "텀블러", 18000, "#5ef0ff"], ["s-cap", "볼캡", 25000, "#16181c"], ["s-socks", "양말 3켤레", 9900, "#8e44ad"], ["s-gift", "기념품 키링", 7000, "#ff8ad8"], ["s-flower", "꽃다발", 30000, "#ff6f91"]]),
    ...item("drink", "bottle", [["s-water", "생수", 1000, "#9fd8ff"]]),
  ],
};
export const SHOP_LABEL: Record<ShopKind, string> = { convenience: "편의점", cafe: "카페", pharmacy: "약국", food: "식당", retail: "매장", cosmetics: "화장품 매장", clothing: "옷 가게", books: "서점", bakery: "베이커리", electronics: "전자 매장", mart: "마트" };

/** what a room sells, by its name and the building's kind; null where nothing is for sale */
export function shopOf(room: string, buildingKind: string, role: string): ShopKind | null {
  if (/편의점|매점|마트|CU|GS|세븐/.test(room)) return "convenience";
  if (/카페|커피|베이커리|빵|디저트/.test(room)) return "cafe";
  if (/약국/.test(room)) return "pharmacy";
  if (/식당|푸드|분식|레스토랑|한식|중식|일식|국수|김밥|구내/.test(room) || role === "cook") return "food";
  if (/매장|상점|숍|샵|쇼핑|판매|문구|기념품|꽃|의류/.test(room) || (role === "clerk" && buildingKind === "retail")) return "retail";
  // (a hospital's or an office's front desk sells nothing; a clerk elsewhere minds a shop)
  if (role === "clerk" && /lobby|안내|원무|접수|수납/.test(room)) return null;
  return null;
}
