import { useEffect } from "react";
import { reportSupportDwell } from "../useActivityTracking";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import CoffeeIcon from "./CoffeeIcon";
import Masthead from "./Masthead";
import Colophon from "./Colophon";
import SupportComments from "./SupportComments";
import CoffeePaymentMethods from "./CoffeePaymentMethods";
import { useL } from "./lib";
import { useBroadsheet } from "./shell";
import "./coffeeSupport.css";

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
  useBroadsheet();
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
        <CoffeePaymentMethods />
      </div>
      <SupportComments />
    </main>
    <Colophon />
  </div>;
}
