import { preprocess, reachableIdentifiers, stripUnusedFunctions } from './ShaderText.js';
self.onmessage = ({ data: { id, op, code, defines } }) => {
  try {
    const full = preprocess(code, defines);
    const value = op === 'reach'
      ? { usedV: reachableIdentifiers(full, 'vs'), usedF: /@fragment\s+fn\s+fs\b/.test(full) ? reachableIdentifiers(full, 'fs') : null }
      : stripUnusedFunctions(full);
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: String(error) }); }
};
