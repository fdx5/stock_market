import { useEffect, useState } from "react";
import { InvestorTrendRecord, api } from "../api/client";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { Link } from "../router";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";

function formatAmount(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (lang === "en") {
    if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}T`;
    return `${sign}${(abs / 10).toFixed(1)}B`;
  }
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

function amountColor(value: number): string {
  if (value > 0) return "var(--up-color)";
  if (value < 0) return "var(--down-color)";
  return "var(--text-muted)";
}

export default function InvestorTrendPage({ code }: { code: string }) {
  const { lang } = useLanguage();
  const t = useT();
  const [name, setName] = useState("");
  const [records, setRecords] = useState<InvestorTrendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .investorTrend(code, 30)
      .then((res) => {
        if (cancelled) return;
        setName(res.name);
        setRecords(res.records);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  const translatedName = useTranslatedText(name);

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="back-link">
          ← {t("메인으로")}
        </Link>
        <div>
          <h1 className="app-title">
            {translatedName || code} {t("투자자별 매매동향")} <span className="app-title-code">{code}</span>
          </h1>
          <LanguageToggle />
          <p className="app-subtitle">
            {t(
              "날짜별 개인·기관·외국인 순매수 금액(억원)입니다. 매수(+)는 빨간색, 매도(-)는 파란색으로 표시됩니다. 무료 공개 데이터의 한계로 하루 단위 집계이며, 장중 실시간(시간대별) 수급은 제공되지 않습니다."
            )}
          </p>
        </div>
      </header>

      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {!loading && !error && (
        <>
          {records.length === 0 ? (
            <div className="empty-state">{t("투자자 매매동향 데이터가 없습니다.")}</div>
          ) : (
            <div className="card investor-trend-table-wrap">
              <table className="investor-trend-table">
                <thead>
                  <tr>
                    <th>{t("날짜")}</th>
                    <th>{t("종가")}</th>
                    <th>{t("등락")}</th>
                    <th>{t("개인")}</th>
                    <th>{t("기관")}</th>
                    <th>{t("외국인")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.date}>
                      <td>{record.date}</td>
                      <td>
                        {record.close.toLocaleString()}
                        {lang === "en" ? " KRW" : "원"}
                      </td>
                      <td style={{ color: record.change >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                        {record.change >= 0 ? "+" : ""}
                        {record.change.toLocaleString()}
                      </td>
                      <td style={{ color: amountColor(record.individual_amount) }}>
                        {formatAmount(record.individual_amount, lang)}
                      </td>
                      <td style={{ color: amountColor(record.institution_amount) }}>
                        {formatAmount(record.institution_amount, lang)}
                      </td>
                      <td style={{ color: amountColor(record.foreign_amount) }}>
                        {formatAmount(record.foreign_amount, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Footer />
    </div>
  );
}
