import { useState } from "react";
import { Link } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import { setTone, useTone } from "./settings";
import { filterMobileMenu, MOBILE_MENU_GROUPS, MOBILE_SHORTCUTS, menuLinkActive } from "./mobileMenuModel";
import NeoIcon from "./NeoIcon";
import "./mobileMenu.css";

export default function MobileMenuTree({ path, filter, onFilter, onNavigate, onSettings }: {
  path: string; filter: string; onFilter: (value: string) => void; onNavigate: () => void; onSettings: () => void;
}) {
  const { lang, setLang } = useLanguage();
  const tone = useTone();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const groups = filterMobileMenu(filter);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(MOBILE_MENU_GROUPS.filter(group => group.links.some(([to]) => menuLinkActive(to, path))).map(group => group.id)));
  const toggle = (id: string) => setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="ng-phone-directory">
    <div className="ng-phone-preferences">
      <div role="group" aria-label={L("메뉴 언어", "Menu language")}><button type="button" aria-pressed={lang === "ko"} onClick={() => setLang("ko")}>한국어</button><button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button></div>
      <div role="group" aria-label={L("화면 테마", "Colour theme")}><button type="button" aria-pressed={tone === "dark"} onClick={() => setTone("dark")}>{L("다크", "Dark")}</button><button type="button" aria-pressed={tone === "light"} onClick={() => setTone("light")}>{L("화이트", "Light")}</button></div>
    </div>
    <label className="ng-phone-search"><NeoIcon name="search" /><input type="search" value={filter} onChange={event => onFilter(event.target.value)} placeholder={L("페이지 이름 검색", "Find a page")} aria-label={L("메뉴에서 페이지 검색", "Search menu pages")} /></label>
    {!filter.trim() && <nav className="ng-phone-shortcuts" aria-label={L("자주 찾는 페이지", "Quick destinations")}>{MOBILE_SHORTCUTS.map(link => <Link key={link.to} to={link.to} onClick={onNavigate} aria-current={path === link.to ? "page" : undefined}><NeoIcon name={link.icon} /><span>{L(link.ko, link.en)}</span><NeoIcon name="arrow" /></Link>)}</nav>}
    <p className="ng-phone-menu-label">{filter.trim() ? L("검색 결과", "Search results") : L("페이지 둘러보기", "Browse pages")}<span>{groups.reduce((sum, group) => sum + group.links.length, 0)}</span></p>
    <nav className="ng-phone-tree" aria-label={L("주요 페이지 메뉴 트리", "Main page directory")}>
      {groups.map(group => {
        const open = !!filter.trim() || expanded.has(group.id);
        const active = group.links.some(([to]) => menuLinkActive(to, path));
        return <section className={active ? "is-current" : ""} key={group.id}>
          <button type="button" className="ng-phone-branch" aria-expanded={open} aria-controls={`phone-menu-${group.id}`} onClick={() => toggle(group.id)}><NeoIcon name={group.icon} /><span>{L(group.ko, group.en)}</span><small>{group.links.length}</small><NeoIcon name="chevron" /></button>
          <ul id={`phone-menu-${group.id}`} hidden={!open}>{group.links.map(([to, ko, en]) => <li key={to}><Link to={to} onClick={onNavigate} aria-current={menuLinkActive(to, path) ? "page" : undefined}><span>{L(ko, en)}{to === "/world-markets" && <b className="ng-new-badge" aria-label={L("새 메뉴", "New")}>N</b>}</span>{menuLinkActive(to, path) ? <small>{L("현재", "Here")}</small> : <NeoIcon name="chevron" />}</Link></li>)}</ul>
        </section>;
      })}
    </nav>
    {!groups.length && <div className="ng-phone-no-results" role="status"><NeoIcon name="search" /><p>{L("일치하는 페이지가 없습니다.", "No matching pages.")}</p><button type="button" onClick={() => onFilter("")}>{L("전체 페이지 보기", "Show all pages")}</button></div>}
    <button type="button" className="ng-phone-display-settings" onClick={onSettings}><NeoIcon name="settings" /><span>{L("화면·효과 설정", "Display & effects")}</span><NeoIcon name="chevron" /></button>
  </div>;
}
