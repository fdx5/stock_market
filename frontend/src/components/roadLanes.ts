import type {RealEstateRoad} from '../api/client';

/** Provider adapters use 1 for missing rdln. The traffic model is two-way,
 * so a wide carriageway must not lose all its paint because of that sentinel.
 * Keep registered multi-lane counts; infer only absent/one-lane wide roads. */
export function roadLaneCount(road:Pick<RealEstateRoad,'width'|'lanes'>) {
 const registered=Number.isFinite(road.lanes)?Math.round(road.lanes):0;
 if(registered>=2)return registered;
 return road.width>=5.6?Math.max(2,Math.round(road.width/3.5)):1;
}
