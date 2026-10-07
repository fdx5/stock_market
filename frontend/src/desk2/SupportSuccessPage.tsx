import { useEffect, useState } from "react";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import CoffeeIcon from "./CoffeeIcon";
import Masthead from "./Masthead";
import Colophon from "./Colophon";
import SupportComments from "./SupportComments";
import { useL } from "./lib";
import { useBroadsheet } from "./shell";
import "./coffeeSupport.css";

type Checkout = { product_id: number; verification: "unverified" };
const products: Record<number, [string, string]> = {
  583316: ["메가커피", "Mega Coffee"], 583318: ["스타벅스 커피", "Starbucks coffee"], 583320: ["블루보틀 커피", "Blue Bottle coffee"],
};

export default function SupportSuccessPage() {
  const L = useL();
  useBroadsheet();
  useDocumentTitle(L("후원해 주셔서 감사합니다 · K-Stock Hub", "Thank you for your support · K-Stock Hub"));
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    fetch("/api/support/buymeacoffee/return", { method: "POST", cache: "no-store", signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error("return");
        return response.json() as Promise<{ checkout: Checkout | null }>;
      }).then(result => { setCheckout(result.checkout); setState("ready"); })
      .catch(() => { if (!abort.signal.aborted) setState("error"); });
    return () => abort.abort();
  }, [retry]);
  const product = checkout ? products[checkout.product_id] : null;
  return <div className="d2 d2-support">
    <Masthead rail={false} onPrint={() => window.print()} />
    <main className="coffee-main coffee-success-main">
      <Link to="/desk" className="coffee-back">← {L("마켓데스크로 돌아가기", "Back to Market Desk")}</Link>
      <section className="coffee-success-letter" aria-labelledby="coffee-success-title">
        <span className="coffee-eyebrow">YOUR COFFEE KEEPS US GOING</span>
        <div className="coffee-mascot"><CoffeeIcon /><span className="coffee-bubble">{L("따뜻한 마음, 고맙습니다!", "Thank you for your kindness!")}</span></div>
        <h1 id="coffee-success-title">{L("보내주신 커피 한 잔,", "A coffee from you,")}<br /><em>{L("큰 힘이 됩니다. 감사합니다.", "means so much. Thank you.")}</em></h1>
        <p>{L("마켓데스크를 응원해 주셔서 진심으로 감사합니다. 보내주신 소중한 마음은 안정적인 서버 운영과 더 나은 데이터, 꾸준한 업데이트를 위해 사용하겠습니다.", "Thank you for supporting Market Desk. Your kindness helps us keep the servers running, improve our data, and bring you regular updates.")}</p>
        <p>{L("내일도 시장을 조금 더 편하게 살펴볼 수 있는 공간으로 보답하겠습니다. 아래에 남겨 주시는 한 줄도 오래 기억할게요. ♡", "We’ll keep making this a place where the markets feel a little easier to follow. We’ll treasure the note you leave below, too. ♡")}</p>
        {product && <span className="coffee-success-product">☕ {L("선택한 커피", "Selected coffee")}: {L(...product)} · Buy Me a Coffee</span>}
        <p className="coffee-success-receipt">{L("결제 금액과 완료 여부는 Buy Me a Coffee 영수증에서 확인해 주세요.", "Please check your Buy Me a Coffee receipt for the amount and payment confirmation.")}</p>
        {state === "loading" && <p className="coffee-comment-notice" role="status">{L("메시지 작성 영역을 준비하고 있어요…", "Preparing your message form…")}</p>}
        {state === "error" && <p className="coffee-comment-notice" role="status">{L("후원 방문 기록을 저장하지 못했습니다. 다시 시도해 주세요.", "Could not save your return visit. Please try again.")} <button type="button" onClick={() => setRetry(value => value + 1)}>{L("다시 시도", "Retry")}</button></p>}
        <Link to="/support" className="coffee-success-link">{L("후원 페이지 보기", "Visit the support page")} →</Link>
      </section>
      {state === "ready" && <SupportComments />}
    </main>
    <Colophon />
  </div>;
}
