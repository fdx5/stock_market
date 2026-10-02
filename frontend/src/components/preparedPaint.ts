import type { PaintJob, TexParams } from './paintClient';
type RecordMap = Record<string, { file: string; params: TexParams }>;
let manifest: Promise<Record<string, RecordMap> | null> | undefined;
const version = import.meta.env.VITE_PAINT_ASSETS as string | undefined;
const base = `/3d/paint/${version}/`;
async function records(): Promise<Record<string, RecordMap> | null> {
  if (!version || import.meta.env.VITE_PAINT_ON_PAGE) return null;
  return manifest ??= fetch(base + 'manifest.json').then(r => r.ok ? r.json() : null).catch(() => null);
}
const decode = async (file: string) => {
  const r = await fetch(base + file); if (!r.ok) throw Error('paint asset unavailable');
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
};
export async function preparedContext(job: PaintJob) {
  if (job.kind !== 'context') return null;
  const maps = (await records())?.[`context-${job.style}-${job.scale ?? 1}`];
  if (!maps) return null;
  const bitmaps: Record<string, ImageBitmap> = {}, params: Record<string, TexParams> = {};
  try {
    const results = await Promise.allSettled(Object.entries(maps).map(async ([name, m]) => { bitmaps[name] = await decode(m.file); params[name] = m.params; }));
    if (results.some(r => r.status === 'rejected')) throw Error('incomplete paint assets');
    return { id: 0, bitmaps, params };
  } catch { Object.values(bitmaps).forEach(b => b.close()); return null; }
}
export async function preparedNormal(job: PaintJob): Promise<ImageBitmap | null> {
  const name = job.kind === 'facade' ? `facade-${job.scale ?? 1}` : job.kind === 'plinth' ? 'plinth' : null;
  if (!name) return null;
  const map = (await records())?.[name]?.normalMap;
  return map ? decode(map.file).catch(() => null) : null;
}
