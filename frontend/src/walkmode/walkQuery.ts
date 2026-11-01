/** Only the public complex key is encoded; no link database or browser storage is needed to open it. */
export function encodeWalkKey(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value.slice(0, 200)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeWalkKey(value: string | null): string {
  if (!value || !/^[A-Za-z0-9_-]{1,800}$/.test(value)) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))).slice(0, 200); }
  catch { return ''; }
}
export function expandWalkQuery(input: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(input), id = decodeWalkKey(q.get('c'));
  if (id && /^\d{5}:/.test(id)) {
    if (!q.has('id')) q.set('id', id);
    if (!q.has('at') && q.get('enter') !== '1' && q.get('o') !== '1') q.set('tour', '1');
  }
  const name = decodeWalkKey(q.get('n')); if (name && !q.has('name')) q.set('name', name);
  if (q.has('a') && !q.has('area')) q.set('area', q.get('a')!);
  return q;
}
export function compactWalkUrl(input: URLSearchParams): string {
  const q = expandWalkQuery(input), p = new URLSearchParams();
  // Preserve the explicit development/facility routes and legacy custom outlines.
  if (q.has('interior') || q.get('enter') === '1') {
    for (const key of ['interior', 'kind', 'level', 'w', 'd', 'floors', 'name', 'enter', 'lat', 'lon', 'foot', 'campus', 'heading', 'door', 'f', 'area', 'original', 'town', 'built', 'cid', 'dong', 'style', 'floor', 'id']) {
      if (q.get(key)) p.set(key, q.get(key)!);
    }
    return '/walk?' + p;
  }
  const id = q.get('id') ?? '';
  if (id) p.set('c', encodeWalkKey(id));
  if (q.has('at')) p.set('at', q.get('at')!);
  else if (id && q.get('tour') !== '1') {
    p.set('o', '1');
    for (const k of ['lat', 'lon']) if (q.get(k)) p.set(k, q.get(k)!);
  }
  if (!id || id.split(':').length < 4) {
    const label = q.get('name'); if (label) p.set('n', encodeWalkKey(label.slice(0, 80)));
  }
  if (q.get('place')) for (const k of ['place', 'lat', 'lon']) if (q.get(k)) p.set(k, q.get(k)!);
  const area = Number(q.get('area')); if (q.get('tour') === '1' && area > 0 && Number.isFinite(area)) p.set('a', String(area));
  const floor = Number(q.get('f')); if (Number.isInteger(floor) && floor !== 0 && floor !== 1 && floor >= -20 && floor <= 200) p.set('f', String(floor));
  return '/walk' + (p.size ? '?' + p : '');
}
export function rememberWalkBack(id: string, back: string) {
  try { sessionStorage.setItem('walk.back:' + id, back); } catch { /* Navigation still works without storage. */ }
}
export function recalledWalkBack(id: string): string | null {
  try { return sessionStorage.getItem('walk.back:' + id); } catch { return null; }
}
