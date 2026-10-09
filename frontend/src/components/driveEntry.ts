/** Development access belongs to the current URL, never a previous visit. */
export function developmentDriveEnabled(search: string): boolean {
  return new URLSearchParams(search).get('devgame') === '1';
}

/** Reuse the standalone game without loading any of its assets into the drone view. */
export function driveEntryUrl(complexId: string, at: { lat: number; lon: number } | null | undefined, hour: number, back: string): string {
  const q = new URLSearchParams({ id: complexId, back });
  if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) {
    q.set('lat', String(at.lat));
    q.set('lon', String(at.lon));
  }
  q.set('t', hour < 6 || hour >= 20 ? 'night' : hour >= 17 ? 'sunset' : 'day');
  return `/drive?${q}`;
}
