import { useEffect, useState } from "react";

export type DataRow = Record<string, any>;
export type ResearchData = { source: string; received_at?: string; coverage?: string; source_url?: string; items: DataRow[]; [key: string]: any };
type Entry = { data?: ResearchData; error?: string; at: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<ResearchData>>();
async function fetchData(url: string) {
  let request = pending.get(url);
  if (!request) {
    request = fetch(url, { cache: "no-cache" }).then(async response => {
      if (!response.ok) throw new Error("원천 자료를 불러오지 못했습니다. 잠시 후 다시 시도하거나 원문 자료를 확인하세요.");
      const data = await response.json();
      return (Array.isArray(data) ? { source: "기존 서비스 공개 응답", items: data } : { ...data, items: data.items ?? data.points ?? [] }) as ResearchData;
    }).finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request;
}

export function useResearch(url: string | null) {
  const [revision, reload] = useState(0);
  const [state, setState] = useState<{ url: string | null; data?: ResearchData; error?: string; loading: boolean }>({ url, loading: !!url });
  useEffect(() => {
    let alive = true;
    if (!url) { setState({ url, loading: false }); return; }
    const previous = memory.get(url);
    setState({ url, data: previous?.data, loading: true });
    if (!revision && previous?.data && Date.now() - previous.at < 60_000) {
      setState({ url, data: previous.data, loading: false }); return;
    }
    void fetchData(url).then(data => {
      memory.set(url, { data, at: Date.now() });
      if (alive) setState({ url, data, loading: false });
    }).catch(error => {
      if (alive) setState({ url, data: previous?.data, error: error instanceof Error ? error.message : "자료 요청 실패", loading: false });
    });
    return () => { alive = false; };
  }, [url, revision]);
  return { ...(state.url === url ? state : { url, loading: !!url }), reload: () => reload(n => n + 1) };
}
