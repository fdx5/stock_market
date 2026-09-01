import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const planetAssets = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../planet-assets",
);

// Backend runs on :8000 in local dev (uvicorn); proxy /api so the frontend
// can always call relative paths, matching the single-origin production setup.
export default defineConfig({
  plugins: [
    react(),
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
      "/api": "http://127.0.0.1:8000",
    },
  },
});
