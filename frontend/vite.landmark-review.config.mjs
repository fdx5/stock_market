import base from './vite.config.ts';
export default async env => {
  const config = typeof base === 'function' ? await base(env) : base;
  config.server.proxy = { '/review-key': 'http://127.0.0.1:8017', '/api/realestate': 'http://127.0.0.1:8017' };
  config.preview = { proxy: config.server.proxy };
  config.build = { outDir: process.env.LANDMARK_REVIEW_OUT_DIR || 'dist-landmark-review', emptyOutDir: false, rollupOptions: { input: 'scripts/landmark-review.html' } };
  return config;
};
