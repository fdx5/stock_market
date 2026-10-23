import { ReactNode } from "react";
import { clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import "./adminWorkspace.css";

const PAGES = [
  ["/admin/dashboard", "콘솔"], ["/admin/growth", "성장 통계"],
  ["/admin/support-log", "후원 로그"], ["/admin/db", "DB 조회"],
  ["/admin/system-atlas", "시스템 아틀라스"], ["/admin/monitor", "모니터"],
  ["/admin/live", "실시간 로그"],
];

/** Admin navigation occupies one horizontal row, leaving width to the workspace
 * and any site-level left menu. Every /admin route shares the same layout.
 */
export default function AdminWorkspace({ path, children }: { path: string; children: ReactNode }) {
  const authed = !!getStoredSession();
  return <div className="admin-workspace">
    <a className="aw-skip" href="#admin-workspace-content">관리자 본문으로 이동</a>
    <header className="aw-header">
      <Link to="/desk" className="aw-brand" title="사이트로 돌아가기">K-Stock <span>Admin</span></Link>
      <nav className="aw-nav" aria-label="관리자 페이지">
        {authed ? PAGES.map(([to, label]) => <Link key={to} to={to} className={path === to ? "is-current" : ""}>{label}</Link>)
          : <span>{path === "/admin/monitor" ? "모니터 접근" : "관리자 로그인"}</span>}
      </nav>
      {authed && <button className="aw-logout" type="button" onClick={() => { clearStoredSession(); navigate("/admin"); }}>로그아웃</button>}
    </header>
    <div className="aw-content" id="admin-workspace-content" tabIndex={-1}>{children}</div>
  </div>;
}
