import { useEffect, useState } from "react";
import { clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import LiveSessionsAndLog, { LiveStatus } from "./LiveSessionsAndLog";
import "./adminLive.css";

/* A single-purpose mobile screen: just the two live panels the classic dashboard
 * buries halfway down a desktop grid (실시간 세션 / 실시간 로그), pulled onto their own
 * route so a phone can open this one URL and watch the site breathe without paying
 * for the growth chart, the comment table, or any of the batch panels around them.
 *
 * The panels themselves live in LiveSessionsAndLog.tsx, shared with the desktop
 * dashboard's 실시간 tab — this page supplies only the mobile topbar around it.
 */

function formatClock(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour12: false });
}

export default function AdminLivePage() {
  useDocumentTitle("실시간 로그 · K-Stock Hub Admin");

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  const [status, setStatus] = useState<LiveStatus>({ lastUpdated: null, connectionOk: true });

  return (
    <div className="admin-live-page">
      <header className="admin-live-topbar">
        <Link to="/admin/dashboard" className="admin-live-back" aria-label="대시보드로 돌아가기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="admin-live-title-wrap">
          <h1>
            <span className={`admin-live-pulse${status.connectionOk ? "" : " admin-live-pulse--off"}`} />
            실시간 로그
          </h1>
          <span className="admin-live-updated">
            {status.lastUpdated
              ? status.connectionOk
                ? `${formatClock(status.lastUpdated)} 갱신`
                : "연결 끊김 · 재시도 중"
              : "연결 중..."}
          </span>
        </div>
        <button
          type="button"
          className="admin-live-logout"
          onClick={() => {
            clearStoredSession();
            navigate("/admin");
          }}
          aria-label="로그아웃"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </header>

      <LiveSessionsAndLog onStatus={setStatus} />
    </div>
  );
}
