import { buildNanotubeGeometry, geometryTransfers } from "./nanotubeGeometry";

self.onmessage = () => {
  try {
    const geometry = buildNanotubeGeometry();
    self.postMessage({ geometry }, { transfer: geometryTransfers(geometry) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Nanotube geometry unavailable" });
  }
};
