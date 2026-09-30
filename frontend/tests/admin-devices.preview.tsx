// Isolated regression fixture. API responses are intercepted by the test runner;
// this harness must never be used to submit data or log into a real admin account.
import { createRoot } from "react-dom/client";
import AdminDevicesPanel from "../src/components/AdminDevicesPanel";
import "../src/styles.css";
import "../src/components/adminDashboard.css";
import "../src/components/adminConsole.css";

createRoot(document.getElementById("root")!).render(<main style={{ maxWidth: 1200, margin: "auto", padding: 16 }}><AdminDevicesPanel /></main>);
