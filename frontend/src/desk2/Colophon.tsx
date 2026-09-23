import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import Logo from "../components/Logo";
import { useL } from "./lib";

/* The colophon.
 *
 * A newspaper's last lines say who made it, where the numbers came from and
 * what the reader may not take them for. The classic footer said the last of
 * those and linked a row of pills; this one lays the whole site out as a
 * directory in four columns, names the sources, and keeps every link, the
 * disclaimer, the contact and the admin door the old footer had. */

const DIRECTORY: { ko: string; en: string; links: { to: string; ko: string; en: string; ext?: boolean }[] }[] = [
  {
    ko: "시장 지도",
    en: "Maps",
    links: [
      { to: "/map", ko: "코스피 시가총액 맵", en: "KOSPI map" },
      { to: "/kosdaq-map", ko: "코스닥 시가총액 맵", en: "KOSDAQ map" },
      { to: "/sp500-map", ko: "S&P 500 맵", en: "S&P 500 map" },
      { to: "/nasdaq100-map", ko: "나스닥 100 맵", en: "NASDAQ 100 map" },
      { to: "/market-bubbles", ko: "증시 버블", en: "Market bubbles" },
      { to: "/kospi-orbit", ko: "증시 궤도", en: "Market orbit" },
    ],
  },
  {
    ko: "순위 · 종목",
    en: "Rankings",
    links: [
      { to: "/stocks", ko: "종목정보", en: "Stocks" },
      { to: "/kospi-100", ko: "코스피 TOP 100", en: "KOSPI TOP 100" },
      { to: "/kosdaq-100", ko: "코스닥 TOP 100", en: "KOSDAQ TOP 100" },
      { to: "/nasdaq-100", ko: "나스닥 TOP 100", en: "NASDAQ TOP 100" },
      { to: "/global-top100", ko: "글로벌 시총 TOP 100", en: "Global TOP 100" },
      { to: "/etf", ko: "ETF 마켓", en: "ETF market" },
    ],
  },
  {
    ko: "분석",
    en: "Analysis",
    links: [
      { to: "/market-brief", ko: "오늘 브리핑", en: "Daily brief" },
      { to: "/ai-prediction", ko: "AI 예측", en: "AI forecast" },
      { to: "/fight", ko: "시총 대결", en: "Market-cap fight" },
      { to: "/dram-price", ko: "D램 가격 이력", en: "DRAM prices" },
      { to: "/index/kospi", ko: "코스피 지수 차트", en: "KOSPI chart" },
      { to: "/global", ko: "해외 주식 데스크", en: "Global desk" },
    ],
  },
  {
    ko: "커뮤니티 · 뉴스",
    en: "Community",
    links: [
      { to: "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", ko: "종목 토론", en: "Discussions" },
      { to: "/news", ko: "글로벌 뉴스", en: "Global news" },
      { to: "/desk2", ko: "클래식 마켓 데스크", en: "Classic desk" },
      { to: "/", ko: "태양계 입구", en: "Entrance" },
      { to: "https://chs2147.github.io/mini-apps", ko: "Mini Apps ↗", en: "Mini Apps ↗", ext: true },
    ],
  },
];

export default function Colophon() {
  const { lang } = useLanguage();
  const L = useL();
  const year = new Date().getFullYear();
  return (
    <footer className="d2-colophon">
      <div className="d2-colophon-top">
        <div className="d2-colophon-brand">
          <Link to="/hub" aria-label="K-Stock Hub">
            <Logo className="d2-colophon-logo" />
          </Link>
          <p>{L("실시간 시세, 시가총액 맵, 시총 대결까지 한눈에 보는 국내 증시 허브.", "Live quotes, market maps and market-cap battles — Korea's market, at a glance.")}</p>
        </div>
        <nav className="d2-colophon-dir" aria-label={L("사이트 전체 메뉴", "Site directory")}>
          {DIRECTORY.map((col) => (
            <div key={col.ko}>
              <h3>{lang === "ko" ? col.ko : col.en}</h3>
              <ul>
                {col.links.map((l) => (
                  <li key={l.to}>
                    {l.ext ? (
                      <a href={l.to} target="_blank" rel="noopener noreferrer">
                        {lang === "ko" ? l.ko : l.en}
                      </a>
                    ) : (
                      <Link to={l.to}>{lang === "ko" ? l.ko : l.en}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="d2-colophon-sources">
        <h3>{L("데이터 출처", "Sources")}</h3>
        <p>
          {L(
            "국내 시세·수급·토론 네이버 금융 · 해외 지수·환율·선물 Yahoo Finance 등 · 메모리 현물 TrendForce · 공포·탐욕 지수 feargreedchart.com · 서울 날씨 Open-Meteo. 1면의 문장과 주목 종목 해설은 사람이 정한 규칙에 따라 위 숫자만으로 조판되며, 언어 모델이 쓰지 않습니다.",
            "Korean quotes, flows and boards: Naver Finance · Global indices, FX and futures: Yahoo Finance and others · Memory spot: TrendForce · Fear & Greed: feargreedchart.com · Seoul weather: Open-Meteo. The front-page copy and spotlight notes are typeset from these numbers by fixed, human-written rules — no language model writes them."
          )}
        </p>
      </div>
      <div className="d2-colophon-bottom">
        <p className="d2-colophon-disclaimer">
          {L(
            "본 서비스에서 제공하는 시세 및 데이터는 투자 참고용이며, 실제 매매 판단의 근거로 사용할 수 없습니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다.",
            "Quotes and data on this service are for reference only and must not be relied on for trading decisions. All investment decisions and their consequences rest with the user."
          )}
        </p>
        <p className="d2-colophon-copy">
          <span>© {year} K-Stock Hub</span>
          <span>Developed by TJ Choi</span>
          <span>
            Contact <a href="mailto:fdx5555@gmail.com">fdx5555@gmail.com</a>
          </span>
          <Link to="/admin" className="d2-colophon-admin" aria-label="Admin" title="Admin">
            ⚙
          </Link>
        </p>
      </div>
    </footer>
  );
}
