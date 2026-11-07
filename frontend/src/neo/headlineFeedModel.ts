export const COMMUNITY_BOARDS = [
  { id: "kr", ko: "국내", en: "KOREA", icon: "chart" },
  { id: "global", ko: "해외", en: "GLOBAL", icon: "globe" },
  { id: "property", ko: "부동산", en: "PROPERTY", icon: "home" },
] as const;
export type CommunityBoard = typeof COMMUNITY_BOARDS[number]["id"];
export type CommunityHeadline = { id: string; title: string; url: string; source: string; published_at: string };

export function communityPostUrl(board: CommunityBoard, postId: string, snapshot = "") {
  const params = new URLSearchParams({ post_id: postId });
  if (/^[a-f0-9]{32}$/.test(snapshot)) params.set("snapshot", snapshot);
  return `/community/${board}?${params}`;
}

/** Only link to valid public originals; newest first, at most ten distinct posts. */
export function latestHeadlines(items: unknown): CommunityHeadline[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const newest = items.filter((post): post is CommunityHeadline => {
    if (!post || typeof post.id !== "string" || !post.id || typeof post.title !== "string" || !post.title.trim() || typeof post.url !== "string" || typeof post.source !== "string" || typeof post.published_at !== "string") return false;
    try { if (!["https:", "http:"].includes(new URL(post.url).protocol)) return false; } catch { return false; }
    return true;
  }).sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0)).filter(post => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
  // Mix available communities without leaving empty slots on a quiet weekend.
  const counts = new Map<string, number>(), chosen: CommunityHeadline[] = [];
  for (const post of newest) {
    const origin = post.source.split(' · ')[0];
    if ((counts.get(origin) ?? 0) >= 4) continue;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
    chosen.push(post);
    if (chosen.length === 10) break;
  }
  for (const post of newest) {
    if (chosen.length === 10) break;
    if (!chosen.some(item => item.id === post.id)) chosen.push(post);
  }
  return chosen.sort((a,b)=>(Date.parse(b.published_at)||0)-(Date.parse(a.published_at)||0));
}
