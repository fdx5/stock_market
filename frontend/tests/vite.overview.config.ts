import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react()],
  optimizeDeps: { entries: ["tests/fixtures/overview-motion.html"] },
  server: { host: "127.0.0.1", port: 5191, strictPort: true },
});
