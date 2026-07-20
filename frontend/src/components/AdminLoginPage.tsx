import { FormEvent, useEffect, useState } from "react";
import { AdminAuthError, getStoredSession, login } from "../adminApi";
import { navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";

export default function AdminLoginPage() {
  useDocumentTitle("관리자 로그인 | K-Stock Hub");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getStoredSession()) navigate("/admin/dashboard");
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/admin/dashboard");
    } catch (err) {
      setError(err instanceof AdminAuthError ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-page">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <div className="admin-login-badge">⚙</div>
        <h1 className="admin-login-title">Admin</h1>
        <p className="admin-login-subtitle">K-Stock Hub 관리자 대시보드</p>
        <label className="admin-login-field">
          <span>아이디</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="admin-login-field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="admin-login-error">{error}</p>}
        <button type="submit" className="admin-login-submit" disabled={loading}>
          {loading ? "확인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
