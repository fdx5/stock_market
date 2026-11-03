/* What a building's counters sell (for play money — wallet.ts), from the catalog (catalog.ts):
 * a convenience store's drinks and snacks, a café's coffee and cake, a pharmacy's tonics, a
 * department store's fashion and beauty, a bookshop's books and notebooks… Drinks and food can be
 * had there and then (the hand's drink animation, its sounds) or carried; goods go in the bag. */
import { PRODUCTS, STORE_CATS, storeItems, type Product, type Store } from "./catalog";
import { shopStyle } from "./shopInteriors";

export type ShopKind = Store;
export type ShopItem = Product;
/** something had at once: a bought drink, a machine's coffee */
export type Consumable = Pick<Product, "id" | "name" | "price" | "kind" | "how" | "color">;
export const SHOP_LABEL: Record<ShopKind, string> = { convenience: "편의점", cafe: "카페", pharmacy: "약국", food: "식당", retail: "매장", cosmetics: "화장품 매장", clothing: "패션 매장", books: "서점", bakery: "베이커리", electronics: "전자 매장", mart: "마트", department: "백화점", eyewear: "안경·선글라스", shoes: "신발 매장", bags: "가방·잡화", variety: "생활용품점", sports: "스포츠 매장" };
/** (kept for callers that list a kind's goods) */
export const SHOP_ITEMS = Object.fromEntries((Object.keys(STORE_CATS) as Store[]).map(k => [k, storeItems(k)])) as Record<ShopKind, ShopItem[]>;
export { PRODUCTS };

/** a business by its name: what it sells */
export function storeOfName(name: string, buildingName = ""): ShopKind | null {
  if (/이마트(?!24)|홈플러스|롯데마트|하나로마트|코스트코|트레이더스|슈퍼마켓|대형마트/.test(name)) return "mart";
  if (/신발|슈즈|ABC마트|나이키|아디다스|뉴발란스|스니커즈|구두/.test(name)) return "shoes";
  if (/가방|백앤|잡화|핸드백|루이|샤넬|구찌|프라다|지갑/.test(name)) return "bags";
  if (/스포츠|아웃도어|골프|등산|노스페이스|데상트/.test(name)) return "sports";
  switch (shopStyle(name)) {
    case "convenience": return "convenience";
    case "cosmetics": case "salon": return "cosmetics";
    case "clothing": return "clothing";
    case "books": return "books";
    case "bakery": return "bakery";
    case "restaurant": return "food";
    case "electronics": return "electronics";
    case "eyewear": return "eyewear";
    case "variety": return "variety";
    case "gym": return "sports";
    case "pcroom": return "convenience";
    case "bank": return null;
  }
  if (/카페|커피|디저트/.test(name)) return "cafe";
  if (/약국/.test(name)) return "pharmacy";
  if (/백화점|아울렛|몰|면세/.test(buildingName)) return "department";
  return null;
}

/** what a room sells, by its name and the building's kind; null where nothing is for sale */
export function shopOf(room: string, buildingKind: string, role: string, buildingName = ""): ShopKind | null {
  const own = storeOfName(room, buildingName);
  if (own) return own;
  if (/편의점|매점|CU|GS|세븐/.test(room)) return "convenience";
  if (/카페|커피|베이커리|빵|디저트/.test(room)) return "cafe";
  if (/약국/.test(room)) return "pharmacy";
  if (/식당|푸드|분식|레스토랑|한식|중식|일식|국수|김밥|구내/.test(room) || role === "cook") return "food";
  if (/아트숍|뮤지엄숍|기념품/.test(room)) return "variety";
  if (/매장|상점|숍|샵|쇼핑|판매|문구|꽃|의류/.test(room) || (role === "clerk" && buildingKind === "retail")) return /백화점|아울렛|몰/.test(buildingName) ? "department" : "retail";
  // (a hospital's or an office's front desk sells nothing; a clerk elsewhere minds a shop)
  return null;
}
