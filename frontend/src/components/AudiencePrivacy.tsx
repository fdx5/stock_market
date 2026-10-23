import { useEffect, useState } from "react";
import { audienceBrowserId, loadAudienceConfig } from "../audienceIdentity";
import { getSessionId } from "../session";
import { useLanguage } from "../i18n/LanguageContext";

export default function AudiencePrivacy() {
  const { lang } = useLanguage();
  const en = lang === "en";
  const [enabled, setEnabled] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let gone = false;
    void loadAudienceConfig().then(config => { if (!gone) { setEnabled(config.enabled); setLocationEnabled(config.location_enabled); } });
    return () => { gone = true; };
  }, []);
  if (!enabled) return null;
  const shareLocation = () => {
    const browser = audienceBrowserId();
    if (!browser) { setStatus(en ? "Audience tracking is disabled by your privacy settings." : "브라우저의 개인정보 보호 설정으로 통계 참여가 꺼져 있습니다."); return; }
    if (!navigator.geolocation) { setStatus(en ? "Location is unavailable in this browser." : "이 브라우저는 위치 확인을 지원하지 않습니다."); return; }
    setBusy(true);
    setStatus(en ? "Waiting for your location permission…" : "위치 권한 허용을 기다리는 중…");
    navigator.geolocation.getCurrentPosition(async position => {
      if (position.coords.accuracy > 5000) { setBusy(false); setStatus(en ? "Location uncertainty is too large. IP estimates will be used." : "위치 오차가 커 참여하지 못했습니다. IP 기반 추정만 사용합니다."); return; }
      try {
        const response = await fetch("/api/activity/audience-location", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browser_id: browser, session_id: getSessionId(), consent: true,
            latitude: Math.round(position.coords.latitude * 1000) / 1000, longitude: Math.round(position.coords.longitude * 1000) / 1000,
            accuracy_m: Math.max(1, position.coords.accuracy) }), signal: AbortSignal.timeout(10000) });
        const result = response.ok ? await response.json() as { accepted: boolean } : null;
        setStatus(result?.accepted ? (en ? "Thank you. Your region was included in the statistics." : "지역 통계에 반영했습니다. 참여해 주셔서 감사합니다.")
          : (en ? "Your region could not be confirmed. Try again later." : "지역을 확인하지 못했습니다. 잠시 후 다시 시도할 수 있습니다."));
      } catch { setStatus(en ? "Your region could not be confirmed." : "지역을 확인하지 못했습니다."); }
      finally { setBusy(false); }
    }, () => { setBusy(false); setStatus(en ? "Location was not shared. You can keep using the site." : "위치를 공유하지 않았습니다. 사이트는 계속 이용할 수 있습니다."); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };
  return <details className="audience-privacy" style={{ marginBlock: 16, fontSize: 12, lineHeight: 1.8 }}>
    <summary style={{ cursor: "pointer" }}>{en ? "Visitor statistics & location privacy" : "방문 통계와 위치 정보 안내"}</summary>
    <p>{en ? "We use a random browser ID and pseudonymized IP values to understand repeat visits and approximate regions. Raw IP addresses are not stored in these statistics. DNT and GPC disable this additional audience collection."
      : "재방문과 대략적인 접속 지역을 파악하기 위해 무작위 브라우저 ID와 가명화한 IP 값을 사용합니다. 새 통계에 원문 IP는 저장하지 않으며, DNT·GPC 설정 시 추가 방문자 통계 수집을 중단합니다."}</p>
    <p><a href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a> · City Lite · CC BY 4.0</p>
    {locationEnabled && <>
      <p>{en ? "Optional: press the button and allow browser location to improve city/region statistics. Your rounded position is sent to our server and its regional lookup service. Only the country and region/city are stored; coordinates and street addresses are not stored in these statistics."
        : "선택 참여: 아래 버튼을 누르고 브라우저 위치 권한을 허용하면 지역 통계의 정확도를 높일 수 있습니다. 약 100m 단위로 반올림한 좌표를 서버와 지역 조회 서비스에 전달하며, 통계에는 국가·시도·도시만 저장합니다. 좌표와 상세 주소는 통계에 저장하지 않습니다."}</p>
      <button type="button" onClick={shareLocation} disabled={busy}>{busy ? (en ? "Checking…" : "확인 중…") : (en ? "Contribute my region" : "정확한 지역 통계에 참여하기")}</button>
    </>}
    {status && <p role="status">{status}</p>}
  </details>;
}
