import { GlobalTop20Item } from "../api/client";
import { coordsForCountry } from "../data/worldMapCoords";

// Simplified continent silhouettes as percentage-space polygons in the same
// equirectangular projection as worldMapCoords.ts (x=(lon+180)/360*100,
// y=(90-lat)/180*100), each vertex hand-computed from real coastline lon/lats so the
// shapes read as an actual world map (SF2-style) without shipping a map asset.
const CONTINENT_BLOBS = [
  // North America (Alaska → Hudson Bay → East Coast → Mexico → West Coast)
  "3.3,12.2 11.1,11.1 16.7,9.4 23.6,10 26.4,13.3 29.2,15.6 33.3,21.1 31.9,25 30.6,26.7 28.9,30.6 27.8,36.1 25,33.9 23.1,35.6 23.1,41.1 20.8,38.9 18.3,32.2 15.6,27.8 15.3,22.8 12.5,17.8 6.9,17.8 3.3,16.7",
  // Greenland
  "33.3,4.4 41.7,3.9 43.9,11.1 37.5,16.7 34.7,11.1",
  // South America
  "27.8,45 30,43.3 33.3,45.6 36.1,50 40.3,54.4 38.9,61.1 36.7,65.6 33.9,71.1 31.9,75 31.1,78.9 30,80 29.2,75 30,66.7 30.6,60 28.6,54.4 27.5,50",
  // Eurasia (Iberia → Scandinavia → Siberia → Kamchatka → Korea/China coast → SE Asia
  // → India → Arabia → Turkey/Mediterranean back to Iberia)
  "47.5,26.1 49.4,23.3 50,21.7 52.2,18.3 51.4,15.6 54.2,11.7 56.9,10.6 61.1,12.2 66.7,11.1 75,7.8 80.6,8.9 88.9,10 97.2,12.8 99.4,13.9 95,16.7 93.3,21.7 89.4,20 87.5,25.6 85.6,28.3 83.9,33.3 80.6,38.9 80,43.3 77.8,46.1 77.2,43.3 75.3,37.8 72.2,45.6 70,38.9 68.6,36.7 66.7,36.1 66.4,37.8 64.4,41.1 61.9,43.3 60.8,38.3 59.4,34.4 60,30 57.5,27.8 56.1,29.4 55,27.8 54.2,25.6 53.3,25 52.8,25.6 51.4,26.1 50,28.9 47.5,29.4",
  // Africa
  "48.3,30.6 52.8,29.4 55.6,31.7 58.9,32.8 59.4,34.4 61.9,43.9 64.2,43.9 61.1,51.1 59.4,63.3 58.6,66.7 55,69.4 53.3,60 52.5,51.1 47.8,47.8 45.3,41.7 45.8,36.7 46.4,34.4",
  // Australia
  "81.7,62.2 83.9,57.8 86.7,56.1 89.4,56.1 90.6,60 92.5,65 91.7,70.6 88.9,71.1 85.8,67.8 81.9,68.9",
  // Japan arc
  "86.1,33.3 88.3,30 89.2,25.6 90.3,25.8 89.2,28.3 87.2,33.9",
  // British Isles
  "48.6,17.8 49.4,20.6 50.3,21.1 49.2,22.2 48.3,20.6",
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

      {(() => {
        // Many roster companies share an HQ country (over half are "USA"), so lay
        // co-located flags out as a tidy little rack (rows of 4) centered on the
        // country's anchor — SF2's map clusters its fighter flags the same way.
        const unselected = roster.filter((it) => it.code !== p1?.code && it.code !== p2?.code);
        const countryIndex = new Map<string, number>();
        return unselected.map((item) => {
          const coord = coordsForCountry(item.country);
          if (!coord) return null;
          const i = countryIndex.get(item.country) ?? 0;
          countryIndex.set(item.country, i + 1);
          const groupSize = unselected.filter((it) => it.country === item.country).length;
          const cols = Math.min(groupSize, 4);
          const rows = Math.ceil(groupSize / 4);
          const col = i % 4;
          const row = Math.floor(i / 4);
          const dx = (col - (cols - 1) / 2) * 1.9;
          const dy = (row - (rows - 1) / 2) * 2.8;
          return (
            <span
              key={item.code}
              className="fight-map-pin-ambient"
              style={{ left: `${coord.x + dx}%`, top: `${coord.y + dy}%` }}
            >
              {item.flag_url && <img src={item.flag_url} alt="" />}
            </span>
          );
        });
      })()}

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
