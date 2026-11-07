import { createRoot } from "react-dom/client";
import { LanguageProvider } from "../../src/i18n/LanguageContext";
import NeoShell from "../../src/neo/NeoShell";
import CommunityHeadlines from "../../src/neo/CommunityHeadlines";
import MarketFearGreed from "../../src/neo/MarketFearGreed";
import "../../src/styles.css";

createRoot(document.getElementById("root")!).render(<LanguageProvider><NeoShell path="/"><main className="d2 ng-home ng-atlas"><CommunityHeadlines /><MarketFearGreed /></main></NeoShell></LanguageProvider>);
