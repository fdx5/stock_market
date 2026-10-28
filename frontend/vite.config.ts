import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import paintAssetsPlugin from "./paintAssetsPlugin.mjs";

const planetAssets = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../planet-assets",
);

// Backend runs on :8000 in local dev (uvicorn); proxy /api so the frontend
// can always call relative paths, matching the single-origin production setup.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    paintAssetsPlugin(),
    {
      name: "public-market-widget-style",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "public-market-widget.css", source: readFileSync(new URL("./src/neo/neo.css", import.meta.url), "utf8") + "\n" + readFileSync(new URL("./src/growth/widget.css", import.meta.url), "utf8") });
      },
      configureServer(server) {
        server.middlewares.use("/public-market-widget.css", (_req, res) => { res.setHeader("Content-Type", "text/css"); res.end(readFileSync(new URL("./src/neo/neo.css", import.meta.url), "utf8") + "\n" + readFileSync(new URL("./src/growth/widget.css", import.meta.url), "utf8")); });
      },
    },
    {
      name: "market-guide-content",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "content/market-guides.json",
          source: readFileSync(new URL("./src/guides/market-guides.json", import.meta.url), "utf8") });
      },
    },
    {
      name: "local-planet-assets",
      configureServer(server) {
        server.middlewares.use("/planet-assets", (request, response, next) => {
          const relative = decodeURIComponent((request.url || "/").split("?")[0]);
          const filename = path.resolve(planetAssets, `.${relative}`);
          if (!filename.startsWith(`${planetAssets}${path.sep}`)) return next();
          try {
            if (!statSync(filename).isFile()) return next();
            response.setHeader("Content-Type", "image/webp");
            response.setHeader("Cache-Control", "public, max-age=3600");
            createReadStream(filename).pipe(response);
          } catch {
            next();
          }
        });
      },
    },
  ],
  server: {
    proxy: {
      ...Object.fromEntries(["/market-snapshot", "/market-card", "/embed/market", "/market-check.ics", "/market-feed.xml"].map(prefix => [prefix, process.env.PUBLIC_MARKETS_API_TARGET || "http://127.0.0.1:8000"])),
      "/api/realestate": process.env.REALESTATE_API_TARGET || loadEnv(mode, process.cwd(), "REALESTATE_").REALESTATE_API_TARGET || "http://127.0.0.1:8000",
      "/api/editorial": process.env.EDITORIAL_API_TARGET || "http://127.0.0.1:8000",
      "/api": "http://127.0.0.1:8000",
    },
  },
}));
