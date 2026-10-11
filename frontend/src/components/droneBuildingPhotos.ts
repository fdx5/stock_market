import type { RealEstateBuildingCard } from '../api/client';

type Photo = NonNullable<RealEstateBuildingCard['photos']>[number];

/** Search results must not turn a personal blog's unrelated image into the building's lead. */
export function buildingBlogPhoto(photo: Pick<Photo, 'thumb' | 'image' | 'link' | 'site'>) {
  if (/블로그|티스토리|blog|tistory/i.test(photo.site ?? '')) return true;
  return [photo.link, photo.image, photo.thumb].some(value => {
    if (!value) return false;
    try {
      const host = new URL(value).hostname.toLowerCase();
      return /(^|\.)(blog\.naver\.com|post\.naver\.com|blog\.daum\.net|tistory\.com|blogspot\.com|wordpress\.com|brunch\.co\.kr|naver\.me)$/.test(host)
        || /(^|\.)(blogfiles|postfiles|blogthumb)\.pstatic\.net$/.test(host);
    } catch { return true; }
  });
}

/** Verified article lead first, named Commons photos next, then the building's search results.
 * Nearby Commons files are photographs of the neighbourhood, not evidence of this building. */
export function droneBuildingPhotos(card: RealEstateBuildingCard | null): Photo[] {
  if (!card) return [];
  const wiki = card.wiki;
  const lead: Photo[] = wiki?.thumb ? [{ thumb: wiki.thumb, image: wiki.image ?? wiki.thumb,
    link: wiki.url, site: '위키백과', w: null, h: null }] : [];
  const photos = (card.photos ?? []).filter(p => p.near !== true && !buildingBlogPhoto(p));
  const seen = new Set<string>();
  return [...lead, ...photos].filter(photo => {
    if (seen.has(photo.thumb) || (photo.image && seen.has(photo.image))) return false;
    seen.add(photo.thumb); if (photo.image) seen.add(photo.image);
    return true;
  }).slice(0, 12);
}
