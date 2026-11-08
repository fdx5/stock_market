// Amount-bearing QR links preserve this site's existing Kakao Pay recipient.
// The amount segment is the selected KRW amount * 8, encoded in hexadecimal.
// This is a remittance link, so final authorization and confirmation belong to Kakao Pay.
export const KAKAO_SUPPORT_OPTIONS = [
  { amount: 3000, url: "https://qr.kakaopay.com/Ej7w8lXu25dc00000", qr: "/img/support/kakaopay-3000.png",
    product: { image: "/img/support/mega-coffee.png", name: "메가커피", english: "Mega Coffee", quantity: 1 } },
  { amount: 5000, url: "https://qr.kakaopay.com/Ej7w8lXu29c400000", qr: "/img/support/kakaopay-5000.png",
    product: { image: "/img/support/starbucks-coffee.png", name: "스타벅스 커피", english: "Starbucks coffee", quantity: 1 } },
  { amount: 7000, url: "https://qr.kakaopay.com/Ej7w8lXu2dac00000", qr: "/img/support/kakaopay-7000.png",
    product: { image: "/img/support/bluebottle-coffee.png", name: "블루보틀 커피", english: "Blue Bottle coffee", quantity: 1 } },
  { amount: 10000, url: "https://qr.kakaopay.com/Ej7w8lXu2138800000", qr: "/img/support/kakaopay-10000.png",
    product: { image: "/img/support/starbucks-coffee.png", name: "스타벅스 커피", english: "Starbucks coffee", quantity: 2 } },
  { amount: null, url: "https://qr.kakaopay.com/Ej7w8lXu2", qr: "/img/support/kakaopay-other.png", product: null },
] as const;

export type KakaoSupportOption = typeof KAKAO_SUPPORT_OPTIONS[number];
export const DEFAULT_KAKAO_SUPPORT = KAKAO_SUPPORT_OPTIONS[0];
export const supportAmountLabel = (amount: number) => amount.toLocaleString("ko-KR");
