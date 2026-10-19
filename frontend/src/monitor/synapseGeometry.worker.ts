import { buildGeometry } from "./synapseGeometry";
self.onmessage = ({ data }) => {
  const geometry = buildGeometry(data.graph);
  const buffers = [geometry.pos, geometry.colors, geometry.along, ...geometry.pp,
    geometry.pc, geometry.offsets, geometry.np, geometry.nc, geometry.ns].map(a => a.buffer);
  self.postMessage({ revision: data.revision, geometry }, { transfer: buffers });
};
