import { FormEvent, useState } from "react";
import { getStoredSession, MonitorLockedError, unlockMonitor } from "../adminApi";
import { Link } from "../router";
import AdminSystemAtlasPage from "./AdminSystemAtlasPage";
import SynapseReadOnlyMonitor from "./SynapseReadOnlyMonitor";
import "./monitor.css";

/** Both entry routes share the observatory. Monitor-only access keeps its existing
 * scope: no atlas/admin APIs are requested with a monitor passcode. */
export default function MonitorPage() {
  return getStoredSession() ? <AdminSystemAtlasPage /> : <SynapseReadOnlyMonitor Lock={MonitorLock} />;
}

function MonitorLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !passcode) return;
    setError(null);
    setBusy(true);
    try {
      await unlockMonitor(passcode);
      onUnlocked();
    } catch (err) {
      // The server's own message carries the useful part — a wrong passcode reads
      // differently from "too many tries, wait 4 minutes", and the visitor needs to
      // know which one they are looking at.
      setError(err instanceof MonitorLockedError ? err.message : "잠금을 해제하지 못했습니다.");
      setPasscode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monitor-lock">
      <form className="monitor-lock-card" onSubmit={handleSubmit}>
        <div className="monitor-lock-badge">
          <i />
          <i />
          <i />
        </div>
        <h1 className="monitor-lock-title">뉴런 모니터</h1>
        <p className="monitor-lock-subtitle">
          사이트 구조와 실시간 신호를 보는 화면입니다.
          <br />
          접속 패스코드를 입력해 주세요.
        </p>
        <label className="monitor-lock-field">
          <span>패스코드</span>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error && <p className="monitor-lock-error">{error}</p>}
        <button type="submit" className="monitor-lock-submit" disabled={busy || !passcode}>
          {busy ? "확인 중…" : "입장"}
        </button>
        <Link to="/" className="monitor-lock-back">
          ← 홈으로
        </Link>
      </form>
    </div>
  );
}
