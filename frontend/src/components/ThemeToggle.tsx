import { useT } from "../i18n/LanguageContext";
import { toggleThemeMode, useThemeMode } from "../theme";

export default function ThemeToggle() {
  const mode = useThemeMode();
  const t = useT();
  const label = mode === "dark" ? t("라이트 테마로 전환") : t("다크 테마로 전환");

  return (
    <button type="button" className="theme-toggle-btn" onClick={toggleThemeMode} aria-label={label} title={label}>
      <span className={`theme-toggle-icon ${mode === "dark" ? "is-risen" : "is-set"}`}>
        <img src="/img/theme-moon.png" alt="" aria-hidden="true" />
      </span>
      <span className={`theme-toggle-icon ${mode === "light" ? "is-risen" : "is-set"}`}>
        <img src="/img/theme-sun.png" alt="" aria-hidden="true" />
      </span>
    </button>
  );
}
