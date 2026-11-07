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
export function latestHeadlines(items: unknown, now = Date.now()): CommunityHeadline[] {
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
  // Exhaust the newest hour before using older posts to mix communities.
  // A quiet source must never displace an available fresh article.
  const fresh = newest.filter(post => Date.parse(post.published_at) >= now - 3_600_000);
  const chosen: CommunityHeadline[] = [];
  for (const pool of [fresh, newest.filter(post => !fresh.includes(post))]) {
    const counts = new Map<string, number>();
    for (const post of pool) {
      if (chosen.length === 10) break;
      const origin = post.source.split(' · ')[0];
      if ((counts.get(origin) ?? 0) >= 4) continue;
      counts.set(origin, (counts.get(origin) ?? 0) + 1);
      chosen.push(post);
    }
    for (const post of pool) {
      if (chosen.length === 10) break;
      if (!chosen.some(item => item.id === post.id)) chosen.push(post);
    }
  }
  return chosen.sort((a,b)=>(Date.parse(b.published_at)||0)-(Date.parse(a.published_at)||0));
}
