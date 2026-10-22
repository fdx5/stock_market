export interface BgmEnvelope {
  fps: number;
  bands: number;
  duration: number;
  data: string;
}

const cache = new Map<string, Promise<BgmEnvelope | null>>();

export function validEnvelope(doc: unknown): doc is BgmEnvelope {
  const value = doc as BgmEnvelope | null;
  return !!value && Number.isFinite(value.fps) && value.fps > 0 && value.fps <= 60 &&
    Number.isInteger(value.bands) && value.bands > 0 && value.bands <= 64 &&
    Number.isFinite(value.duration) && value.duration > 0 &&
    typeof value.data === "string" && /^[0-9a-z]+$/.test(value.data) &&
    value.data.length % value.bands === 0 &&
    Math.abs(value.data.length / value.bands / value.fps - value.duration) < 0.15;
}

/** Shared in-flight requests: desktop/mobile controls never fetch a track twice. */
export function loadBgmEnvelope(trackId: string): Promise<BgmEnvelope | null> {
  let request = cache.get(trackId);
  if (!request) {
    request = fetch(`/bgm/${trackId}.json`).then(async response => {
      if (!response.ok) return null;
      const doc: unknown = await response.json();
      return validEnvelope(doc) ? doc : null;
    }).catch(() => null);
    cache.set(trackId, request);
  }
  return request;
}

/** Resample all source bands into the displayed bar count, rather than dropping
 * the treble when the compact player draws 12 bars for a 14-band envelope. */
export function envelopeLevel(doc: BgmEnvelope, seconds: number, index: number, bars: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const frames = doc.data.length / doc.bands;
  const frame = Math.min(Math.max(Math.floor(seconds * doc.fps), 0), frames - 1);
  const from = index * doc.bands / bars;
  const to = (index + 1) * doc.bands / bars;
  let sum = 0;
  for (let band = Math.floor(from); band < Math.ceil(to); band++) {
    const weight = Math.min(to, band + 1) - Math.max(from, band);
    sum += parseInt(doc.data[frame * doc.bands + band], 36) / 35 * weight;
  }
  return sum / (to - from);
}
