import type { DriveSpec } from "../../drivegame/vehicle/physics";
import type { ParkedCar } from "./ParkedCars";
export interface CarProfile { spec: DriveSpec; topKmh: number; seed: number; engine: "ev" | "sport" | "diesel" | "truck" | "petrol"; eye: [number, number, number]; layout: number }
const TOP:Record<string,number>={sedan:188,"sedan-sports":236,suv:184,"suv-luxury":216,"hatchback-sports":148,van:162,"sedan-large":228,"suv-small":178,"kei-box":136,mpv:192,taxi:182,pickup:168,"micro-ev":92,"city-hatch":144,"sport-coupe":248,"luxury-coupe":242,"electric-fastback":224,"sport-fastback":252,"family-wagon":196,"sport-wagon":232,"compact-sedan":172,"executive-lwb":244,"electric-sedan":212,"crossover-coupe":208,"compact-crossover":176,"electric-crossover":204,"electric-suv":218,"premium-suv":238,"offroad-suv":164,"seven-seat-suv":198,"family-mpv":186,"executive-mpv":194,"compact-van":156,"passenger-van-lwb":154,cargo:124,boxtruck:118,bus:112,container:106,garbage:96,mixer:102};
export function carProfile(car: Pick<ParkedCar, "kind" | "label" | "length" | "width" | "height">): CarProfile {
  let hash = 2166136261; for (const c of car.kind) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); const seed = hash >>> 0;
  const ev = /electric|micro-ev/.test(car.kind), sport = /sport|coupe/.test(car.kind), diesel = /van|mpv|cargo|truck|bus|container|garbage|mixer|pickup/.test(car.kind);
  const truck=/cargo|truck|bus|container|garbage|mixer/.test(car.kind);
  const base = /micro/.test(car.kind) ? 86 : /city|hatchback|kei/.test(car.kind) ? 130 : sport ? 220 : /executive|premium|luxury/.test(car.kind) ? 207 : diesel ? 118 : ev ? 183 : /suv|crossover/.test(car.kind) ? 163 : 175;
  const topKmh = TOP[car.kind]??base + (seed % 17) * 1.3, vmax = topKmh / 3.6;
  const eye: [number, number, number] = [car.width * 0.215,truck?Math.min(car.height-.24,2.15):Math.min(car.height - 0.19, 0.85 + car.height * 0.28),truck?car.length*.5-.8:car.length * (diesel ? .19 : .07)];
  return { topKmh, seed, engine: ev ? "ev" : sport ? "sport" : truck?"truck":diesel ? "diesel" : "petrol", eye, layout: seed % 6,
    spec: { label: car.label, wheelbase: car.length * (.57 + (seed % 5) * .012), length: car.length, width: car.width, vmax,
      accel: (ev ? 5.4 : sport ? 4.8 : diesel ? 2.2 : 3.2) + (seed % 13) * .09, brake: 7.5 + (seed % 11) * .12,
      reverseMax: 4.2 + (seed % 7) * .12, gears: ev ? null : [.12,.24,.40,.59,.79,1].map(v => v * vmax), idleRpm: ev ? 0 : diesel ? 720 : 810,
      redline: ev ? 16000 : sport ? 7200 : diesel ? 4200 : 6200, lock: .47 + (seed % 9) * .012, eye,
      sound: "", pitch: [.6, 1.7], fuelUse: ev ? .25 : 1 } };
}
