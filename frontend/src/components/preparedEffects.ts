/** Lossless exports of the original procedural effect pixels, decoded off-thread. */
export async function preparedEffect(name: 'moon' | 'wakeMap' | 'wakeNormal' | 'wash' | 'spray') {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1500);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}3d/effects/a3765f7e5d6f70f93cf9/${name}.png`, { signal: abort.signal });
    if (!response.ok) throw Error(`Prepared effect ${name}: ${response.status}`);
    return await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } finally { clearTimeout(timer); }
}
