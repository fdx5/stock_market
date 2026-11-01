import {compactWalkUrl, rememberWalkBack} from '../walkmode/walkQuery';
/** The standalone walk (/walk): where it starts, the hour and weather it opens in, and where back leads. */
export function walkEntryUrl(complexId: string, at: { lat: number; lon: number } | null | undefined, hour: number, weather: string, back: string): string {
  const q = new URLSearchParams({ id: complexId, back, hour: String(hour), weather });
  if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) {
    q.set('lat', String(at.lat));
    q.set('lon', String(at.lon));
  }
  return `/walk?${q}`;
}

/** Open this complex's original-plan chooser without loading the outdoor world. */
export function roomTourUrl(complexId: string, area: number, back: string, name = ''): string {
  const q = new URLSearchParams({ id: complexId, tour: '1' });
  rememberWalkBack(complexId, back);
  const label = name || complexId.split(':').slice(3).join(':');
  if (label) q.set('name', label.slice(0, 80));
  if (Number.isFinite(area) && area > 0) q.set('area', String(area));
  return compactWalkUrl(q);
}
