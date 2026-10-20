import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/desk2/desk2.css";
import MarketOverview from "../../src/desk2/discover/MarketOverview";
import type { MarketMapItem } from "../../src/api/client";

const params = new URLSearchParams(location.search);
const market = params.get("market") === "us" ? "us" : "kr";
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const items = [1.2, -0.8, 0, 2.5, -1.3, 1.1].map((change_pct, index) => ({
  code: String(index), name: "Fixture", close: 100, change_pct, volume: 1000, marcap: 100000,
})) as MarketMapItem[];
createRoot(document.getElementById("root")!).render(<div className="d2 ed-home">
  <main style={{ padding: "24px 16px", maxWidth: 1320, margin: "auto" }}>
    <MarketOverview market={market} items={items} asOf="09:35" leadingSector="정보기술" bigTechMove={1.24} bigTechShare={0.427} />
    <div style={{ height: 1800 }} aria-hidden="true" />
  </main>
</div>);
