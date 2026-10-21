import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

const zones = [{ zone: "Asia/Seoul", ko: "한국", en: "SEOUL", tag: "KST" }, { zone: "America/New_York", ko: "뉴욕", en: "NEW YORK", tag: "ET" }];
const timeFormat = zones.map(({ zone }) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short" }));
const dateFormat = zones.map(({ zone }) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "2-digit", day: "2-digit" }));

export default function NeoHeaderClocks() {
  const { lang } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(new Date()); };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return <div className="ng-header-clocks" aria-label={lang === "ko" ? "한국과 뉴욕 현지 시각" : "Seoul and New York local time"}>
    {zones.map((zone, i) => {
      const parts = timeFormat[i].formatToParts(now);
      const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
      const dateParts = dateFormat[i].formatToParts(now);
      const day = dateParts.find(part => part.type === "day")?.value;
      const month = dateParts.find(part => part.type === "month")?.value;
      return <div className="ng-header-clock" key={zone.zone} data-zone={zone.zone}><span>{lang === "ko" ? zone.ko : zone.en}<small>{i ? get("timeZoneName") : zone.tag}</small></span><time dateTime={now.toISOString()}>{get("hour")}<i>:</i>{get("minute")}<i>:</i>{get("second")}</time><span className="ng-clock-date">{month}.{day}</span></div>;
    })}
  </div>;
}
