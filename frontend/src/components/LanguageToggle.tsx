import { useLanguage } from "../i18n/LanguageContext";

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <span className="lang-toggle">
      <button type="button" className={lang === "ko" ? "active" : ""} onClick={() => setLang("ko")}>
        KO
      </button>
      <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
        EN
      </button>
    </span>
  );
}
