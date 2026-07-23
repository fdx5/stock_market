import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "./i18n/LanguageContext";
import "./styles.css";

// If a deploy swaps out the hashed chunks while this tab is still open, navigating to a
// lazily-loaded route dynamic-imports a chunk filename that no longer exists (404) and
// would white-screen. Vite fires `vite:preloadError` for exactly that — reload once so
// the tab pulls the fresh index.html and its current chunk names instead of breaking.
// A short sessionStorage guard prevents an infinite reload loop if the chunk is genuinely
// unreachable (e.g. offline) rather than just deploy-stale.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const KEY = "chunkReloadAt";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
