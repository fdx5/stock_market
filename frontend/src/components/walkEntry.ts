/** Development access belongs to the current URL, never a previous visit. */
export function developmentWalkEnabled(search: string): boolean {
  return new URLSearchParams(search).get('devwalk') === '1';
}

/** The standalone walk (/walk): where it starts, the hour and weather it opens in, and where back leads. */
export function walkEntryUrl(complexId: string, at: { lat: number; lon: number } | null | undefined, hour: number, weather: string, back: string): string {
  const q = new URLSearchParams({ id: complexId, back, hour: String(hour), weather });
  if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) {
    q.set('lat', String(at.lat));
    q.set('lon', String(at.lon));
  }
  return `/walk?${q}`;
}
