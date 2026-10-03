import { FormEvent, useEffect, useRef, useState } from "react";
import { AdminAuthError, MonthlySupporter, adminApi, clearStoredSession } from "../adminApi";
import { navigate } from "../router";
import "./adminSupporters.css";

function seoulMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

export default function AdminSupportersPanel() {
  const [month, setMonth] = useState(seoulMonth);
  const [items, setItems] = useState<MonthlySupporter[]>([]);
  const [nickname, setNickname] = useState("");
  const [color, setColor] = useState<"gold" | "silver">("gold");
  const [editing, setEditing] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  function failure(error: unknown) {
    if (error instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); }
    else setNotice(error instanceof Error ? error.message : "처리하지 못했습니다. 다시 시도해 주세요.");
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setItems([]); setEditing(undefined); setNickname(""); setNotice("");
    adminApi.monthlySupporters(month).then(result => { if (active) setItems(result.items); })
      .catch(error => { if (active) failure(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !nickname.trim()) return;
    pending.current = true; setBusy(true); setNotice("");
    try {
      const result = await adminApi.saveMonthlySupporter({ month, nickname: nickname.trim(), color }, editing);
      setItems(previous => [...previous.filter(item => item.id !== result.id), result].sort((a, b) => a.id - b.id));
      setNickname(""); setEditing(undefined); setNotice("저장했습니다. 해당 월의 후원자 전광판에 반영됩니다.");
    } catch (error) { failure(error); }
    finally { pending.current = false; setBusy(false); }
  }

  async function remove(item: MonthlySupporter) {
    if (pending.current || !window.confirm(`${item.month} 후원자 ‘${item.nickname}’을 명단에서 삭제할까요?`)) return;
    pending.current = true; setBusy(true);
    try {
      await adminApi.deleteMonthlySupporter(item.id);
      setItems(previous => previous.filter(row => row.id !== item.id));
      if (editing === item.id) { setEditing(undefined); setNickname(""); }
      setNotice("후원자 명단에서 삭제했습니다.");
    } catch (error) { failure(error); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="admin-ops-section admin-supporters">
    <h2 className="admin-ops-heading">☕ 월별 후원자 관리</h2>
    <p className="admin-supporters-help">후원을 확인한 닉네임을 월별로 등록하세요. 현재 월의 명단이 후원 페이지 전광판에 표시되고, 이전 달 명단은 별도로 보관됩니다.</p>
    <label className="admin-supporters-month" htmlFor="supporters-month">관리할 월<input id="supporters-month" type="month" value={month} min="2000-01" max="2099-12" disabled={busy} onChange={event => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} /></label>
    <form className="admin-supporters-form" onSubmit={save}>
      <label htmlFor="supporter-admin-nickname">후원자 닉네임<input ref={field} id="supporter-admin-nickname" type="text" value={nickname} maxLength={20} required autoComplete="off" placeholder="공개할 닉네임을 입력하세요" disabled={busy || loading} onChange={event => setNickname(event.target.value)} /></label>
      <label htmlFor="supporter-admin-color">전광판 글자색<select id="supporter-admin-color" value={color} disabled={busy || loading} onChange={event => setColor(event.target.value as "gold" | "silver")}><option value="gold">금색 ✦</option><option value="silver">은색 ✧</option></select></label>
      <span className={`admin-supporter-preview is-${color}`}>{nickname || "닉네임 미리보기"}</span>
      <button type="submit" disabled={busy || loading || !nickname.trim()}>{busy ? "저장 중…" : editing ? "수정 저장" : "후원자 저장"}</button>
      {editing && <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setNickname(""); }}>수정 취소</button>}
    </form>
    <p className="admin-supporters-help">같은 달에 같은 닉네임을 다시 저장하면 글자색이 갱신됩니다. 댓글 작성자와 후원자 명단은 독립적으로 관리됩니다.</p>
    {notice && <p role="status" className="admin-supporters-notice">{notice}</p>}
    <h3>{month} 후원자 {loading ? "" : `(${items.length}명)`}</h3>
    {loading ? <p role="status">불러오는 중…</p> : <ul className="admin-supporter-list">{items.map(item => <li key={item.id}>
      <b className={`admin-supporter-preview is-${item.color}`}>{item.nickname}</b><span>{item.color === "gold" ? "금색" : "은색"}</span>
      <button disabled={busy} onClick={() => { setEditing(item.id); setNickname(item.nickname); setColor(item.color); field.current?.focus(); }}>수정</button>
      <button disabled={busy} onClick={() => remove(item)}>삭제</button>
    </li>)}</ul>}
    {!loading && items.length === 0 && <p className="admin-empty">이 달에 등록된 후원자가 없습니다.</p>}
  </section>;
}
