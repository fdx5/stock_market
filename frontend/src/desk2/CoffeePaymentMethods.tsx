import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useL } from "./lib";
import NeoIcon from "../neo/NeoIcon";
import { DEFAULT_KAKAO_SUPPORT, KAKAO_SUPPORT_OPTIONS, supportAmountLabel, type KakaoSupportOption } from "./supportAmounts";

const METHODS = ["kakaopay", "buymeacoffee"] as const;
const products = [
  { id: 583316, name: "메가커피", english: "Mega Coffee", price: "$2", style: "mega", image: "mega-coffee.png", note: "가볍게 전하는 따뜻한 응원", englishNote: "A little warmth to keep us going" },
  { id: 583318, name: "스타벅스 커피", english: "Starbucks coffee", price: "$4", style: "starbucks", image: "starbucks-coffee.png", note: "다음 업데이트를 위한 한 잔", englishNote: "A cup for the next update" },
  { id: 583320, name: "블루보틀 커피", english: "Blue Bottle coffee", price: "$6", style: "bluebottle", image: "bluebottle-coffee.png", note: "오래 이어갈 마음을 담은 한 잔", englishNote: "A little kindness for the road ahead" },
];

export default function CoffeePaymentMethods() {
  const L = useL();
  const [method, setMethod] = useState<typeof METHODS[number]>("kakaopay");
  const [selected, setSelected] = useState<KakaoSupportOption>(DEFAULT_KAKAO_SUPPORT);
  const [qrOpen, setQrOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)");
    const update = () => setQrOpen(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    setMethod(METHODS[next]);
    tabs.current[next]?.focus();
  }
  return <aside className="coffee-payment ng-panel" aria-labelledby="coffee-payment-title">
    <div className="coffee-payment-heading"><span className="coffee-payment-symbol"><NeoIcon name="coffee" /></span><div><span className="coffee-payment-tag">{L("한 잔의 응원", "A cup of kindness")}</span><h2 id="coffee-payment-title">{L("커피를 골라 주세요", "Choose a coffee to send")}</h2></div></div>
    <div className="coffee-payment-tabs" role="tablist" aria-label={L("후원 결제 방법", "Payment method")}>
      {METHODS.map((value, index) => <button key={value} type="button" role="tab"
        id={`coffee-tab-${value}`} aria-controls={`coffee-panel-${value}`} aria-selected={method === value}
        tabIndex={method === value ? 0 : -1} ref={element => { tabs.current[index] = element; }}
        onClick={() => setMethod(value)} onKeyDown={event => onKeyDown(event, index)}>
        {value === "buymeacoffee" ? "Buy Me a Coffee" : L("카카오페이", "Kakao Pay")}
      </button>)}
    </div>
    <div role="tabpanel" id="coffee-panel-kakaopay" aria-labelledby="coffee-tab-kakaopay" hidden={method !== "kakaopay"} tabIndex={0}>
      <KakaoSupportPanel selected={selected} onSelect={setSelected} qrOpen={qrOpen} onQrToggle={setQrOpen} />
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
    <span className="coffee-signoff">{L("보내주신 마음, 소중히 쓰겠습니다. ♡", "Thank you for helping us keep going. ♡")}</span>
  </aside>;
}

export function KakaoSupportPanel({ selected, onSelect, qrOpen = true, onQrToggle }: { selected: KakaoSupportOption; onSelect: (option: KakaoSupportOption) => void; qrOpen?: boolean; onQrToggle?: (open: boolean) => void }) {
  const L = useL();
  const amountText = selected.amount === null ? L("직접 입력", "Choose your amount") : `${supportAmountLabel(selected.amount)}${L("원", " KRW")}`;
  const qrLabel = selected.amount === null ? L("금액 미지정", "Any amount") : amountText;
  const product = selected.product;
  return <>
    <div className="coffee-item-summary" data-other={!product}>
    <figure className="coffee-selected-product" hidden={!product}>
      <div className="coffee-product-preview-stage">
        {KAKAO_SUPPORT_OPTIONS.map(option => option.product && <img key={option.amount} src={option.product.image}
          hidden={selected.amount !== option.amount} width="240" height="240" alt={L(option.product.name, option.product.english)} />)}
        {product && product.quantity > 1 && <span className="coffee-product-multiplier" aria-hidden="true">×{product.quantity}</span>}
      </div>
    </figure>
    <div className="coffee-selected-amount" role="status" aria-live="polite" aria-atomic="true">
      <small>{L("선택한 후원 금액", "Selected amount")}</small>
      <strong>{selected.amount === null ? amountText : <>{supportAmountLabel(selected.amount)}<span>{L("원", " KRW")}</span></>}</strong>
      {product ? <span className="coffee-selected-name">{L(product.name, product.english)}{product.quantity > 1 && L(" 두 잔", " · 2 cups")}</span> : <span className="coffee-selected-name">{L("카카오페이에서 금액을 입력해 주세요", "Enter your preferred amount in Kakao Pay")}</span>}
    </div>
    </div>
    <fieldset className="coffee-amounts">
      <legend>{L("후원 금액", "Support amount")}</legend>
      <div className="coffee-amount-options">{KAKAO_SUPPORT_OPTIONS.map(option => <label key={option.amount ?? "other"} className="coffee-amount-option" data-selected={selected.amount === option.amount} data-other={option.amount === null}>
        <input type="radio" name="kakaopay-support-amount" value={option.amount ?? "other"} checked={selected.amount === option.amount} onChange={() => onSelect(option)} />
        <span>{option.amount === null ? L("기타 · 직접 입력", "Other · choose amount") : `${supportAmountLabel(option.amount)}${L("원", " KRW")}`}</span>
      </label>)}</div>
    </fieldset>
    <a data-activity-key="support-pay" className="coffee-pay-button" href={selected.url} target="_blank" rel="noopener noreferrer">
      <span className="coffee-pay-mark" aria-hidden="true">pay</span>{selected.amount === null ? L("원하는 금액으로 후원하기", "Support with any amount") : L(`${amountText} 후원하기`, `Support with ${amountText}`)} <span aria-hidden="true">↗</span>
    </a>
    <small className="coffee-pay-help">{L("휴대폰에서는 위 버튼을 눌러 주세요.", "On your phone, tap the button above.")}</small>
    <details className="coffee-qr-details" open={qrOpen} onToggle={event => onQrToggle?.(event.currentTarget.open)}>
      <summary><span>{L("QR 코드로 후원하기", "Support with a QR code")}</span><NeoIcon name="chevron" /></summary>
      <div className="coffee-qr-content">
    <a href={selected.url} target="_blank" rel="noopener noreferrer" data-activity-key="support-qr" className="coffee-qr-link"
      aria-label={L(`${qrLabel} 카카오페이 후원 QR 코드 · 송금 링크 열기`, `Kakao Pay ${qrLabel} QR · open support link`)}>
      {KAKAO_SUPPORT_OPTIONS.map(option => <img key={option.amount ?? "other"} src={option.qr} hidden={selected.amount !== option.amount}
        width="240" height="240" alt={option.amount === null ? L("금액 미지정 카카오페이 후원 QR 코드", "Kakao Pay support QR with no preset amount") : L(`${supportAmountLabel(option.amount)}원 카카오페이 후원 QR 코드`, `Kakao Pay ${supportAmountLabel(option.amount)} KRW support QR code`)} />)}
    </a>
    <p className="coffee-qr-help">{selected.amount === null ? L("QR 코드를 스캔한 뒤 카카오페이에서 원하는 후원 금액을 직접 입력해 주세요.", "Scan the QR code, then enter your preferred amount in Kakao Pay.") : L(`QR 코드를 스캔하면 선택한 ${amountText}이 담긴 카카오페이 후원 화면으로 연결됩니다.`, `Scan the QR code to open Kakao Pay with ${amountText} selected.`)}</p>
      </div>
    </details>
    <div className="coffee-payment-note">{L("송금 전 카카오페이 화면에서 받는 분과 금액을 확인해 주세요. 후원 완료 여부는 카카오페이 송금 내역에서 확인할 수 있습니다.", "Check the recipient and amount in Kakao Pay before sending. Your Kakao Pay history confirms completion.")}</div>
  </>;
}
