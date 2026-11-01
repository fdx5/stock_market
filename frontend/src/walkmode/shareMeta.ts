/** Public apartment identity is in the URL: Kakao's crawler cannot read sessionStorage. */
import {compactWalkUrl, expandWalkQuery} from './walkQuery';
export const WALK_SHARE_IMAGE = 'https://kospimap.com/img/social/walk-roomtour-v1.png';
export function walkShareMeta(params: URLSearchParams) {
  params = expandWalkQuery(params);
  const raw = params.get('name') || params.get('place') || (params.get('id') ?? '').split(':').slice(3).join(':');
  const name = raw.replace(/[<>"\\\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return {
    title: `${name ? name + ' | ' : ''}룸투어(임장) | KOSPIMAP`,
    description: `${name ? name + '의 ' : '아파트 '}평형과 원본 도면을 확인하고, 가구가 배치된 실내를 3D로 둘러보세요.`,
    image: WALK_SHARE_IMAGE,
    alt: 'KOSPIMAP 룸투어(임장) 안내용 아파트 거실 이미지',
  };
}
export function updateWalkShare(params = new URLSearchParams(location.search)) {
  const meta = walkShareMeta(params);
  document.title = meta.title;
  const tags: Record<string, string> = {
    'name="description"': meta.description,
    'property="og:title"': meta.title, 'property="og:description"': meta.description,
    'property="og:url"': `https://kospimap.com${compactWalkUrl(params)}`,
    'property="og:type"': 'website', 'property="og:image"': meta.image,
    'property="og:image:secure_url"': meta.image, 'property="og:image:type"': 'image/png',
    'property="og:image:alt"': meta.alt, 'property="og:image:width"': '1729', 'property="og:image:height"': '910',
    'name="twitter:title"': meta.title, 'name="twitter:description"': meta.description,
    'name="twitter:image"': meta.image, 'name="twitter:image:alt"': meta.alt,
  };
  for (const [selector, value] of Object.entries(tags)) document.querySelector(`meta[${selector}]`)?.setAttribute('content', value);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://kospimap.com${location.pathname.replace(/\/$/, '')}`);
}
