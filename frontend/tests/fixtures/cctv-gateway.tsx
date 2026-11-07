import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import CctvPopup from "../../src/components/CctvPopup";
import type { TrafficCamera } from "../../src/components/trafficCctv";
import { mergeCameras } from "../../src/components/trafficCctv";
import "../../src/components/traffic-cctv.css";

function Probe() {
  const [camera, setCamera] = useState<TrafficCamera | null>(null);
  const [closed, setClosed] = useState(false);
  const query = new URLSearchParams(location.search);
  const lat = Number(query.get("lat") || 37.4289), lon = Number(query.get("lon") || 127.1083);
  const load = () => fetch(`/api/realestate/cctv?lat=${lat}&lon=${lon}&fresh=true`).then(r => r.json()).then(data => {
    const wanted = query.get("camera");
    const choices = query.get("provider") ? data.items.filter((c: TrafficCamera) => c.id.startsWith(query.get("provider")! + ':')) : mergeCameras(data.items, {lat,lon});
    setCamera(choices.find((c: TrafficCamera) => wanted ? c.name.includes(wanted) : c.name.includes("고등")) || choices[0]);
  });
  useEffect(() => { void load(); }, []);
  return <main style={{ minHeight: "100vh", background: "#100d13", color: "white" }}>{!closed && camera && <CctvPopup key={`${camera.id}:${camera.media}`} camera={camera} onClose={() => setClosed(true)} onRefresh={() => void load()} />}</main>;
}
createRoot(document.getElementById("root")!).render(<Probe />);
