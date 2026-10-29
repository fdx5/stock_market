export interface Drink { id: string; name: string; group: string; color: string; brand?: string; zero?: boolean }
const soda: [string, string, string, string, boolean?][] = [
  ["cider", "칠성사이다", "#087d43", "cider"], ["mccol", "맥콜", "#f4d46b", "mccol"],
  ["pepsi", "펩시", "#0758ad", "pepsi"], ["coke", "코카콜라", "#e51b28", "coke"],
  ["fanta", "환타 오렌지", "#f68b18", "fanta"], ["fanta-grape", "환타 포도", "#643a9e", "fanta"],
  ["sprite", "스프라이트", "#00834d", "sprite"], ["milkis", "밀키스", "#e4f1f9", "milkis"],
  ["pepsi-zero", "펩시 제로", "#12151c", "pepsi", true], ["coke-zero", "코카콜라 제로", "#ba1424", "coke", true],
  ["demisoda", "데미소다 애플", "#53a64d", "demisoda"], ["oranc", "오란씨 파인애플", "#f4c52c", "oranc"],
];
export const DRINKS: Drink[] = [
  ...soda.map(([id, name, color, brand, zero]) => ({ id, name, color, brand, zero, group: "탄산" })),
  ...([
    ["커피", "아메리카노,라테,바닐라 라테,모카,콜드브루,디카페인", "#6c4938"],
    ["차", "녹차,보리차,우롱차,홍차,레몬티,복숭아 아이스티", "#7e9e51"],
    ["주스", "오렌지 주스,사과 주스,포도 주스,망고 주스,자몽 주스,토마토 주스", "#eaa44a"],
    ["기타", "생수,탄산수,이온 음료,초코 우유,딸기 우유,두유", "#a6bfe1"],
  ] as const).flatMap(([group, names, color], i) => names.split(",").map((name, j) => ({ id: `${i}-${j}`, name, group, color }))),
];
