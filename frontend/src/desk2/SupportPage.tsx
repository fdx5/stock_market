import { useEffect } from "react";
import { reportSupportDwell } from "../useActivityTracking";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import CoffeeIcon from "./CoffeeIcon";
import Masthead from "./Masthead";
import Colophon from "./Colophon";
import SupportComments from "./SupportComments";
import { useL } from "./lib";
import { useBroadsheet } from "./shell";
import "./coffeeSupport.css";

const KAKAOPAY_URL = "https://qr.kakaopay.com/Ej7w8lXu2";

export default function SupportPage() {
  useEffect(() => {
    let started = document.visibilityState === "visible" ? performance.now() : null;
    const flush = () => {
      if (started === null) return;
      const now = performance.now();
      reportSupportDwell((now - started) / 1000);
      started = document.visibilityState === "visible" ? now : null;
    };
    const visibility = () => {
      flush();
      started = document.visibilityState === "visible" ? performance.now() : null;
    };
    const leave = () => { flush(); started = null; };
    const resume = () => { started = document.visibilityState === "visible" ? performance.now() : null; };
    const timer = window.setInterval(flush, 15000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", resume);
    return () => { leave(); clearInterval(timer); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", resume); };
  }, []);
  const L = useL();
  useBroadsheet({ lightByDefault: true });
  useDocumentTitle(L("커피 한 잔 후원하기 · K-Stock Hub", "Buy us a coffee · K-Stock Hub"));
  return <div className="d2 d2-support">
    <Masthead rail={false} onPrint={() => window.print()} />
    <main className="coffee-main" id="support-content">
      <Link to="/desk" className="coffee-back">← {L("마켓데스크로 돌아가기", "Back to Market Desk")}</Link>
      <div className="coffee-layout">
        <section className="coffee-letter" aria-labelledby="coffee-title">
          <span className="coffee-eyebrow">A LITTLE COFFEE, A LOT OF HEART</span>
          <div className="coffee-mascot"><CoffeeIcon /><span className="coffee-bubble">{L("내일도 함께해요!", "See you tomorrow!")}</span></div>
          <h1 id="coffee-title">{L("오늘도 도움이 되었다면,", "If we helped you today,")}<br /><em>{L("커피 한 잔으로 응원해 주세요", "send a little coffee our way")}</em></h1>
          <p className="coffee-intro">{L("복잡한 시장을 조금 더 쉽고, 한눈에 볼 수 있도록. 마켓데스크는 오늘도 데이터를 정리하고 더 나은 화면을 만들어 갑니다.", "Making a complex market a little easier to see. Every day, Market Desk brings data together and works on a better experience.")}</p>
          <p>{L("매일 만나는 이 공간을 꾸준히 업데이트하고 안정적으로 운영하려면, 지속적인 개발과 서버 운영 비용이 필요합니다. 보내주시는 후원은 서버를 유지하고, 데이터를 관리하며, 새로운 기능과 개선을 이어가는 데 소중한 보탬이 됩니다.", "Keeping this space updated and running reliably takes ongoing development and server costs. Your support helps maintain our servers and data, and keeps new features and improvements moving forward.")}</p>
          <p>{L("마켓데스크가 시장을 살펴보는 시간에 작은 도움이 되었다면, 커피 한 잔의 마음으로 응원해 주시겠어요? 그 따뜻한 응원이 내일의 업데이트를 준비하는 큰 힘이 됩니다.", "If Market Desk has made your time following the markets a little easier, would you consider supporting us with a coffee? That small kindness means a lot as we prepare tomorrow’s updates.")}</p>
          <div className="coffee-purpose" aria-label={L("후원이 보탬이 되는 곳", "What your support helps with")}><span>↻ {L("꾸준한 업데이트", "Regular updates")}</span><span>☁ {L("안정적인 서버 운영", "Reliable servers")}</span><span>✧ {L("더 나은 서비스", "A better experience")}</span></div>
          <p className="coffee-thanks">{L("후원은 언제나 자유로운 선택입니다. 찾아와 주시고 이용해 주시는 것만으로도 감사합니다. 오래도록 유용한 공간으로 보답하겠습니다.", "Support is always optional. We’re grateful that you visit and use the site. We’ll keep working to make this a useful place for you, for a long time to come.")}</p>
        </section>
        <aside className="coffee-payment" aria-labelledby="coffee-payment-title">
          <span className="coffee-payment-tag">{L("따뜻한 마음 한 잔", "A cup of kindness")}</span>
          <h2 id="coffee-payment-title">{L("커피 한 잔 후원하기", "Buy us a coffee")}</h2>
          <p>{L("카카오페이로 간편하게 마음을 전해 주세요.", "Send your support easily with Kakao Pay.")}</p>
          <a data-activity-key="support-pay" className="coffee-pay-button" href={KAKAOPAY_URL} target="_blank" rel="noopener noreferrer"><span className="coffee-pay-mark">pay</span>{L("카카오페이로 후원하기", "Support with Kakao Pay")} <span aria-hidden="true">↗</span></a>
          <small className="coffee-pay-help">{L("휴대폰에서는 위 버튼을 눌러 주세요.", "On your phone, tap the button above.")}</small>
          <div className="coffee-divider"><span>{L("PC에서는 QR 코드로", "On desktop, scan the QR")}</span></div>
          <a href={KAKAOPAY_URL} target="_blank" rel="noopener noreferrer" data-activity-key="support-qr" className="coffee-qr-link" aria-label={L("카카오페이 후원 QR 코드 · 결제 링크 열기", "Kakao Pay support QR · open payment link")}><img src="/img/kakaopay-support.png" alt={L("카카오페이 후원 결제 QR 코드", "Kakao Pay support payment QR code")} /></a>
          <p className="coffee-qr-help">{L("휴대폰 카메라로 QR 코드를 스캔하면 카카오페이 후원 화면으로 연결됩니다.", "Scan this QR code with your phone camera to open the Kakao Pay support page.")}</p>
          <div className="coffee-payment-note">{L("후원 금액과 결제 완료 여부는 카카오페이 화면에서 확인해 주세요.", "Please check the amount and payment confirmation in Kakao Pay.")}</div>
          <span className="coffee-signoff">{L("보내주신 마음, 소중히 쓰겠습니다. ♡", "Thank you for helping us keep going. ♡")}</span>
        </aside>
      </div>
      <SupportComments />
    </main>
    <Colophon />
  </div>;
}
