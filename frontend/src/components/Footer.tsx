import { useT } from "../i18n/LanguageContext";
import { Link } from "../router";

export default function Footer() {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer-top">
        <Link to="/" className="app-brand app-footer-brand" aria-label="K-Stock Hub">
          <img src="/img/kstock-logo.png" alt="K-Stock Hub" className="app-footer-logo" />
        </Link>
        <p className="app-footer-tagline">
          {t("실시간 시세, 시가총액 맵, 시총 대결까지 한눈에 보는 국내 증시 허브.")}
        </p>
        <nav className="app-footer-links">
          <Link to="/">{t("홈")}</Link>
          <Link to="/map">🗺 KOSPI MAP</Link>
          <Link to="/kosdaq-map">🟢 KOSDAQ MAP</Link>
          <Link to="/battle">{t("🔥 시총 대결")}</Link>
        </nav>
      </div>
      <div className="app-footer-bottom">
        <p className="app-footer-disclaimer">
          {t(
            "본 서비스에서 제공하는 시세 및 데이터는 투자 참고용이며, 실제 매매 판단의 근거로 사용할 수 없습니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다."
          )}
        </p>
        <p className="app-footer-copy">© {year} K-Stock Hub</p>
      </div>
    </footer>
  );
}
