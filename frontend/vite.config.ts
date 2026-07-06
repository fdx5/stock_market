import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend runs on :8000 in local dev (uvicorn); proxy /api so the frontend
// can always call relative paths, matching the single-origin production setup.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
