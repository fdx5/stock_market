import { useEffect } from "react";
import { reportSupportDwell } from "../useActivityTracking";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import NeoIcon from "../neo/NeoIcon";
import { HoloPanel } from "../neo/NeoComponents";
import SupportComments from "./SupportComments";
import CoffeePaymentMethods from "./CoffeePaymentMethods";
import { useL } from "./lib";
import "./coffeeSupport.css";
import "../neo/supportPage.css";

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
  useDocumentTitle(L("커피 한 잔 후원하기 · K-Stock Hub", "Buy us a coffee · K-Stock Hub"));
  return <div className="d2 d2-support coffee-support-page">
    <main className="coffee-main" id="support-content">
      <div className="coffee-page-topline"><span className="ng-kicker">KOSPIMAP / SUPPORT</span><Link to="/desk" className="coffee-back">← {L("마켓데스크", "Market Desk")}</Link></div>
      <header className="coffee-page-header">
        <div><h1>{L("커피 한 잔 후원하기", "A coffee for the next update")}</h1><p>{L("오늘의 작은 도움이, 내일의 더 나은 시장 화면으로 이어집니다.", "A little kindness today helps us build a better view of the markets tomorrow.")}</p></div>
        <span className="coffee-page-badge"><NeoIcon name="coffee" />{L("한 잔의 따뜻한 응원", "A little kindness, a lasting impact")}</span>
      </header>
      <div className="coffee-layout">
        <CoffeePaymentMethods />
        <div className="coffee-story-column">
          <HoloPanel className="coffee-story" title={L("함께 만드는 마켓데스크", "Building Market Desk together")}>
            <div className="coffee-story-icon"><NeoIcon name="coffee" /></div>
            <span className="ng-kicker">A LITTLE COFFEE, A LOT OF HEART</span>
            <h2>{L("오늘의 한 잔이,", "A coffee today,")}<br /><em>{L("내일의 업데이트로.", "an update tomorrow.")}</em></h2>
            <p>{L("복잡한 시장을 더 쉽고, 한눈에 볼 수 있도록. 보내주신 응원은 데이터를 정리하고 더 나은 기능을 만드는 데 소중히 쓰겠습니다.", "Making complex markets easier to see. Your support helps us bring data together and keep improving the tools you use.")}</p>
            <div className="coffee-story-thanks"><NeoIcon name="spark" /><p>{L("후원은 자유로운 선택입니다. 찾아와 이용해 주시는 것만으로도 감사합니다.", "Support is always optional. We’re grateful that you visit and use the site.")}</p></div>
          </HoloPanel>
          <HoloPanel className="coffee-purpose-panel" title={L("후원이 보탬이 되는 곳", "What your support helps with")}>
            <h2>{L("보내주신 응원은 이곳에", "Where your support goes")}</h2>
            <ul>{[
              ["bolt", "안정적인 서버 운영", "Reliable servers", "언제 찾아와도 편안하게 시장을 살펴볼 수 있도록.", "Keeping the market within reach whenever you visit."],
              ["layers", "꾸준한 데이터 관리", "Care for the data", "흩어진 시장 정보를 더 쉽고 명확하게 정리합니다.", "Bringing scattered market information into a clearer view."],
              ["chart", "다음 기능과 업데이트", "The next improvement", "더 유용한 도구와 편리한 화면을 만들어 갑니다.", "Building useful tools and making the experience easier."],
            ].map(([icon, ko, en, description, englishDescription]) => <li key={icon}><span><NeoIcon name={icon} /></span><div><h3>{L(ko, en)}</h3><p>{L(description, englishDescription)}</p></div></li>)}</ul>
          </HoloPanel>
        </div>
      </div>
      <SupportComments />
    </main>
  </div>;
}
