import type { PaintJob, TexParams } from './paintClient';
type RecordMap = Record<string, { file: string; params: TexParams }>;
let manifest: Promise<Record<string, RecordMap> | null> | undefined;
const version = import.meta.env.VITE_PAINT_ASSETS as string | undefined;
const base = `/3d/paint/${version}/`;
async function download(path: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(path, {signal:controller.signal});
    if (!response.ok) throw Error('paint asset unavailable');
    return await response.blob();
  } finally { clearTimeout(timer); }
}
async function records(): Promise<Record<string, RecordMap> | null> {
  if (!version || import.meta.env.VITE_PAINT_ON_PAGE) return null;
  return manifest ??= download(base + 'manifest.json').then(async blob => JSON.parse(await blob.text())).catch(() => null);
}
const decode = async (file: string, flipY = false) => {
  return createImageBitmap(await download(base + file), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: flipY ? 'flipY' : 'none' });
};
export async function preparedContext(job: PaintJob) {
  if (job.kind !== 'context') return null;
  const maps = (await records())?.[`context-${job.style}-${job.scale ?? 1}`];
  if (!maps) return null;
  const bitmaps: Record<string, ImageBitmap> = {}, params: Record<string, TexParams> = {};
  try {
    const results = await Promise.allSettled(Object.entries(maps).map(async ([name, m]) => {
      bitmaps[name] = await decode(m.file, m.params.flipY);
      params[name] = {...m.params, flipY:false, immutableKey:version + '/' + m.file};
    }));
    if (results.some(r => r.status === 'rejected')) throw Error('incomplete paint assets');
    return { id: 0, bitmaps, params };
  } catch { Object.values(bitmaps).forEach(b => b.close()); return null; }
}
export async function preparedNormal(job: PaintJob): Promise<ImageBitmap | null> {
  if (job.kind === 'facade' && job.appearance === 'architecture') return null;
  const name = job.kind === 'facade' ? `facade-${job.scale ?? 1}` : job.kind === 'plinth' ? 'plinth' : null;
  if (!name) return null;
  const map = (await records())?.[name]?.normalMap;
  return map ? decode(map.file).catch(() => null) : null;
}
