// A module served by the asset CDN must still start Workers on the site's origin.
// The server serves a tiny module import there; the worker payload lives on GitHub.
export function assetDeliveryConfig() {
  const workers = new Set();
  return {
    experimental: {
      renderBuiltUrl(filename, { hostType }) {
        if (hostType === 'js') return { runtime: `(globalThis.location.origin+${JSON.stringify('/' + filename)})` };
        // CSS is evaluated at its final CDN URL, unlike the HTML document.
        return hostType === 'css' ? `https://kospimap.com/${filename}` : `/${filename}`;
      },
    },
    worker: {
      format: 'es',
      plugins: () => [{
        name: 'cdn-worker-entries',
        generateBundle(_options, bundle) {
          for (const item of Object.values(bundle)) {
            if (item.type === 'chunk' && item.isEntry) workers.add(item.fileName);
          }
        },
      }],
    },
    plugins: [{
      name: 'cdn-worker-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'worker-entries.json', source: JSON.stringify([...workers].sort()) });
      },
    }],
  };
}
