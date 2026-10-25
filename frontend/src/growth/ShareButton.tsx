import { useEffect, useRef, useState } from "react";
import { publicShareUrl } from "./publicLinks";
import { reportGrowthAction } from "../useActivityTracking";

export default function ShareButton({ path, search = "", title = "KOSPIMAP 시장 데이터" }: { path: string; search?: string; title?: string }) {
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const url = publicShareUrl(path, search);
  useEffect(() => { setMessage(""); setManual(false); }, [path, search]);
  useEffect(() => { if (manual) field.current?.select(); }, [manual]);
  if (!url) return null;
  async function share() {
    setBusy(true); setMessage(""); setManual(false);
    try {
      if (navigator.share) {
        try { await navigator.share({ title, url: publicShareUrl(path, search, "native")! }); reportGrowthAction("share_success"); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
      }
      try { if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable"); await navigator.clipboard.writeText(url!); setMessage("링크를 복사했습니다."); reportGrowthAction("link_copy"); }
      catch { setManual(true); }
    } finally { setBusy(false); }
  }
  return <span className="market-share-control"><button type="button" disabled={busy} onClick={share}>공유하기 ↗</button><span role="status">{message}</span>{manual && <label>공유 링크<input ref={field} readOnly value={url} onFocus={e => e.currentTarget.select()} /></label>}</span>;
}
