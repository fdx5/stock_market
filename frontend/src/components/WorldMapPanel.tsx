import { GlobalTop20Item } from "../api/client";
import { coordsForCountry } from "../data/worldMapCoords";

// Rough continent silhouettes as percentage-space polygons (decorative only, not
// cartographically precise — see worldMapCoords.ts for the actual pin math) so the
// panel reads as "a world map" without needing a real map asset.
const CONTINENT_BLOBS = [
  "8,15 25,12 30,20 28,35 20,45 12,42 5,30", // North America
  "22,48 30,46 33,60 28,78 20,75 18,58", // South America
  "45,15 58,14 60,25 52,30 44,28", // Europe
  "48,32 62,30 65,45 58,68 50,70 44,55 45,40", // Africa
  "58,10 88,8 92,30 85,45 75,50 65,42 60,25", // Asia
  "85,62 96,60 98,72 88,75 83,68", // Australia
];

interface FighterPin {
  item: GlobalTop20Item;
  player: "p1" | "p2";
}

export default function WorldMapPanel({
  roster,
  p1,
  p2,
}: {
  roster: GlobalTop20Item[];
  p1: GlobalTop20Item | null;
  p2: GlobalTop20Item | null;
}) {
  const pins: FighterPin[] = [];
  if (p1) pins.push({ item: p1, player: "p1" });
  if (p2) pins.push({ item: p2, player: "p2" });

  return (
    <div className="fight-map-panel">
      <svg className="fight-map-svg" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="fight-map-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="var(--fight-grid-line)" strokeWidth="0.15" />
          </pattern>
          <linearGradient id="fight-map-sweep-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--fight-p1)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--fight-p1)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--fight-p1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="100" height="50" fill="url(#fight-map-grid)" />
        {CONTINENT_BLOBS.map((points, idx) => (
          <polygon key={idx} points={points} className="fight-map-continent" />
        ))}
        <rect className="fight-map-sweep" width="30" height="50" />
      </svg>

      {roster.map((item) => {
        const coord = coordsForCountry(item.country);
        if (!coord) return null;
        const isSelected = item.code === p1?.code || item.code === p2?.code;
        if (isSelected) return null;
        return (
          <span
            key={item.code}
            className="fight-map-pin-ambient"
            style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
          />
        );
      })}

      {pins.map(({ item, player }) => {
        const coord = coordsForCountry(item.country);
        if (!coord) return null;
        return (
          <div
            key={player}
            className={`fight-map-pin fight-map-pin--${player}`}
            style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
          >
            <span className="fight-map-pin-label">{player === "p1" ? "1P" : "2P"}</span>
            <div className="fight-map-pin-glow">
              {item.flag_url && <img src={item.flag_url} className="fight-map-pin-flag" alt="" />}
              {item.logo_url && <img src={item.logo_url} className="fight-map-pin-logo" alt={item.name} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
