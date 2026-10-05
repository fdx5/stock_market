import { KeyboardEvent, useRef, useState } from "react";
import { useL } from "./lib";

const KAKAOPAY_URL = "https://qr.kakaopay.com/Ej7w8lXu2";
const products = [
  { id: 583316, name: "메가커피", english: "Mega Coffee", price: "$2", style: "mega", image: "mega-coffee.png", note: "가볍게 전하는 따뜻한 응원", englishNote: "A little warmth to keep us going" },
  { id: 583318, name: "스타벅스 커피", english: "Starbucks coffee", price: "$4", style: "starbucks", image: "starbucks-coffee.png", note: "다음 업데이트를 위한 한 잔", englishNote: "A cup for the next update" },
  { id: 583320, name: "블루보틀 커피", english: "Blue Bottle coffee", price: "$6", style: "bluebottle", image: "bluebottle-coffee.png", note: "오래 이어갈 마음을 담은 한 잔", englishNote: "A little kindness for the road ahead" },
];

export default function CoffeePaymentMethods() {
  const L = useL();
  const [method, setMethod] = useState<"buymeacoffee" | "kakaopay">("buymeacoffee");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    setMethod(next === 0 ? "buymeacoffee" : "kakaopay");
    tabs.current[next]?.focus();
  }
  return <aside className="coffee-payment" aria-labelledby="coffee-payment-title">
    <span className="coffee-payment-tag">{L("따뜻한 마음 한 잔", "A cup of kindness")}</span>
    <h2 id="coffee-payment-title">{L("커피 한 잔 후원하기", "Buy us a coffee")}</h2>
    <p>{L("편한 결제 방법으로 마음을 전해 주세요.", "Choose how you’d like to send a little kindness.")}</p>
    <div className="coffee-payment-tabs" role="tablist" aria-label={L("후원 결제 방법", "Payment method")}>
      {(["buymeacoffee", "kakaopay"] as const).map((value, index) => <button key={value} type="button" role="tab"
        id={`coffee-tab-${value}`} aria-controls={`coffee-panel-${value}`} aria-selected={method === value}
        tabIndex={method === value ? 0 : -1} ref={element => { tabs.current[index] = element; }}
        onClick={() => setMethod(value)} onKeyDown={event => onKeyDown(event, index)}>
        {value === "buymeacoffee" ? "Buy Me a Coffee" : L("카카오페이", "Kakao Pay")}
      </button>)}
    </div>
    <div role="tabpanel" id="coffee-panel-buymeacoffee" aria-labelledby="coffee-tab-buymeacoffee" hidden={method !== "buymeacoffee"} tabIndex={0}>
      <a className="coffee-bmc-button" href="https://buymeacoffee.com/fdx5" target="_blank" rel="noopener noreferrer"
        data-activity-key="support-pay" aria-label={L("Buy Me a Coffee 후원 페이지 열기", "Open our Buy Me a Coffee page")}>
        <img src="/img/buymeacoffee-button.png" alt="Buy me a coffee" width="545" height="153" />
      </a>
      <p className="coffee-shop-intro">{L("보내고 싶은 커피 한 잔을 골라 주세요.", "Pick a coffee to send our way.")}</p>
      <div className="coffee-products">{products.map(product => <a key={product.id}
        className={`coffee-product coffee-product-${product.style}`} href={`/api/support/buymeacoffee/checkout/${product.id}`}
        data-activity-key="support-pay" aria-label={L(`${product.name} ${product.price} 후원하기 · Buy Me a Coffee 결제 화면으로 이동`, `Support with ${product.english} ${product.price} · continue to Buy Me a Coffee`)}>
        <span className="coffee-product-icon" aria-hidden="true"><img src={`/img/support/${product.image}`} alt="" width="240" height="240" loading="lazy" decoding="async" /></span>
        <span className="coffee-product-copy"><b>{L(product.name, product.english)}</b><span className="coffee-product-price">{product.price}</span><small>{L(product.note, product.englishNote)}</small></span>
        <span className="coffee-product-arrow" aria-hidden="true">↗</span>
      </a>)}</div>
      <div className="coffee-payment-note">{L("상품 금액과 이용 가능한 결제 수단은 Buy Me a Coffee 결제 화면에서 확인해 주세요. 결제 후 감사 페이지로 돌아옵니다.", "Check prices and available payment methods on Buy Me a Coffee. After checkout, you’ll return to our thank-you page.")}</div>
    </div>
    <div role="tabpanel" id="coffee-panel-kakaopay" aria-labelledby="coffee-tab-kakaopay" hidden={method !== "kakaopay"} tabIndex={0}>
      <a data-activity-key="support-pay" className="coffee-pay-button" href={KAKAOPAY_URL} target="_blank" rel="noopener noreferrer"><span className="coffee-pay-mark">pay</span>{L("카카오페이로 후원하기", "Support with Kakao Pay")} <span aria-hidden="true">↗</span></a>
      <small className="coffee-pay-help">{L("휴대폰에서는 위 버튼을 눌러 주세요.", "On your phone, tap the button above.")}</small>
      <div className="coffee-divider"><span>{L("PC에서는 QR 코드로", "On desktop, scan the QR")}</span></div>
      <a href={KAKAOPAY_URL} target="_blank" rel="noopener noreferrer" data-activity-key="support-qr" className="coffee-qr-link" aria-label={L("카카오페이 후원 QR 코드 · 결제 링크 열기", "Kakao Pay support QR · open payment link")}><img src="/img/kakaopay-support.png" alt={L("카카오페이 후원 결제 QR 코드", "Kakao Pay support payment QR code")} /></a>
      <p className="coffee-qr-help">{L("휴대폰 카메라로 QR 코드를 스캔하면 카카오페이 후원 화면으로 연결됩니다.", "Scan this QR code with your phone camera to open the Kakao Pay support page.")}</p>
      <div className="coffee-payment-note">{L("후원 금액과 결제 완료 여부는 카카오페이 화면에서 확인해 주세요.", "Please check the amount and payment confirmation in Kakao Pay.")}</div>
    </div>
    <span className="coffee-signoff">{L("보내주신 마음, 소중히 쓰겠습니다. ♡", "Thank you for helping us keep going. ♡")}</span>
  </aside>;
}
