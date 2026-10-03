import { FormEvent, useEffect, useRef, useState } from "react";
import { useL } from "./lib";

type Comment = { id: number; username: string; text: string; created_at: string };
type Feed = { items: Comment[]; next_before: number | null };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "입력을 확인하고 잠시 후 다시 시도해 주세요.");
  return result;
}

export default function SupportComments() {
  const L = useL();
  const [items, setItems] = useState<Comment[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [supported, setSupported] = useState(false);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const pending = useRef(false);
  const submission = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    request<Feed>("/api/support/comments", { signal: abort.signal }).then(feed => {
      setItems(feed.items); setNext(feed.next_before);
    }).catch(() => { if (!abort.signal.aborted) setLoadError(true); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    request<{ token: string }>("/api/support/comment-token", { signal: abort.signal }).then(result => setToken(result.token)).catch(() => {});
    return () => abort.abort();
  }, []);

  async function loadMore() {
    if (moreLoading) return;
    setMoreLoading(true);
    try {
      const feed = await request<Feed>(`/api/support/comments${next ? `?before=${next}` : ""}`);
      setItems(previous => next ? [...previous, ...feed.items.filter(item => !previous.some(old => old.id === item.id))] : feed.items);
      setNext(feed.next_before); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setMoreLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !supported || !text.trim()) return;
    pending.current = true; setSending(true); setNotice("");
    try {
      if (!token) {
        const result = await request<{ token: string }>("/api/support/comment-token");
        setToken(result.token);
        setNotice(L("등록 준비가 완료되었습니다. 3초 뒤 등록 버튼을 다시 눌러 주세요.", "Ready to post. Please tap Post again in three seconds."));
        return;
      }
      const name = username.trim() || L("커피친구", "Coffee friend");
      const key = JSON.stringify([name, text.trim()]);
      if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
      const result = await request<Comment>("/api/support/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, text: text.trim(), request_id: submission.current!.id, token, website, supported }),
      });
      setItems(previous => [result, ...previous.filter(item => item.id !== result.id)]);
      setText(""); setSupported(false); submission.current = null;
      setNotice(L("따뜻한 응원 한 줄이 등록되었습니다. 감사합니다! ♡", "Your kind message has been posted. Thank you! ♡"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : L("등록하지 못했습니다. 잠시 후 다시 시도해 주세요.", "Could not post. Please try again shortly."));
      // Renew expired tokens; keep the request id so uncertain saves cannot duplicate.
      request<{ token: string }>("/api/support/comment-token").then(result => setToken(result.token)).catch(() => setToken(""));
    } finally { pending.current = false; setSending(false); }
  }

  return <section className="coffee-comments" aria-labelledby="coffee-comments-title">
    <div className="coffee-comments-heading"><span aria-hidden="true">♡</span><div><h2 id="coffee-comments-title">{L("마음을 남기는 한 줄", "A little note of kindness")}</h2><p>{L("후원해 주셨다면, 따뜻한 응원 한 줄을 남겨 주세요. 보내주신 마음도 오래 기억하겠습니다.", "After supporting us, leave a little note. We’ll treasure your kindness, too.")}</p></div></div>
    <form className="coffee-comment-form" onSubmit={submit}>
      <div className="coffee-comment-fields">
        <label htmlFor="coffee-nickname">{L("닉네임 (선택)", "Nickname (optional)")}<input id="coffee-nickname" type="text" maxLength={20} value={username} onChange={e => setUsername(e.target.value)} placeholder={L("커피친구", "Coffee friend")} disabled={sending} autoComplete="off" /></label>
        <label htmlFor="coffee-message">{L("응원 한 줄", "Your message")}<input id="coffee-message" type="text" maxLength={120} required value={text} onChange={e => setText(e.target.value)} placeholder={L("덕분에 오늘도 시장을 편하게 살펴봤어요. 응원합니다!", "Thanks for making the markets easier to follow!")} disabled={sending} autoComplete="off" /></label>
      </div>
      <div className="coffee-honeypot" aria-hidden="true"><label>Website<input type="text" name="website" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
      <div className="coffee-comment-submit"><label className="coffee-support-check"><input type="checkbox" checked={supported} onChange={e => setSupported(e.target.checked)} required disabled={sending} />{L("후원 후 응원 메시지를 남깁니다.", "I’m leaving a note after supporting the site.")}</label><span className="coffee-comment-count">{text.length}/120</span><button type="submit" disabled={sending || !supported || !text.trim()}>{sending ? L("등록 중…", "Posting…") : L("응원 남기기", "Post message")}</button></div>
      {notice && <p className="coffee-comment-notice" role="status">{notice}</p>}
    </form>
    {loading ? <p className="coffee-comments-empty" role="status">{L("응원 메시지를 불러오고 있어요…", "Loading messages…")}</p> : <>
      {loadError ? <p className="coffee-comments-empty" role="status">{L("메시지를 불러오지 못했습니다.", "Could not load messages.")} <button onClick={loadMore} disabled={moreLoading}>{L("다시 시도", "Retry")}</button></p> : items.length === 0 && <p className="coffee-comments-empty">{L("아직 남겨진 응원은 없어요. 첫 번째 따뜻한 마음을 남겨 주세요. ☕", "Be the first to leave a little kindness. ☕")}</p>}
      <ul className="coffee-comment-list">{items.map(item => <li key={item.id}><div className="coffee-comment-author"><span aria-hidden="true">☕</span><b>{item.username}</b><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })}</time></div><p>{item.text}</p></li>)}</ul>
      {next && <button className="coffee-comment-more" onClick={loadMore} disabled={moreLoading}>{moreLoading ? L("불러오는 중…", "Loading…") : L("응원 더 보기", "More messages")}</button>}
    </>}
  </section>;
}
