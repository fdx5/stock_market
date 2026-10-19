import type {RoadTileResult} from './droneRoads';
import {sceneWork} from './sceneWorkerClient';
import {cutTileStreets,streetTransfer,type TileStreetsResult} from './tileStreetCut';
import type {PackedRings} from './nearBuildingTargets';
type Ring=[number,number][];

/** Fit all visible tile surfaces before admission. Retain the same exact ground
 * asphalt triangles as the guard for subsequent measured building replacements.
 * The whole fit is one scene-worker job (tileStreetCut.ts): on the page, between frames, its four
 * cuts and the ground's triangles took ~20 s of a slow laptop's streamed tile, the drone held back
 * in front of it. On the page, in slices, only where no worker runs. null: cancelled or failed
 * (the arrays went to the worker). */
export async function fitTileStreetSurfaces(roads:RoadTileResult,buildings:Ring[],pace:()=>Promise<boolean>):Promise<PackedRings|null>{
 const args={surface:roads.surface,marks:roads.marks,marksFar:roads.marksFar,walks:roads.walks,buildings};
 const job=sceneWork('tileStreets',args,streetTransfer([roads.surface,roads.marks,roads.marksFar,roads.walks]));
 let fit:TileStreetsResult|null;
 if(job)try{fit=await job;}catch{fit=null;}
 else fit=await cutTileStreets(args,pace);
 if(!fit||!await pace())return null;
 if(roads.surface&&fit.surface)Object.assign(roads.surface,fit.surface);
 if(roads.marks&&fit.marks)Object.assign(roads.marks,fit.marks);
 if(roads.marksFar&&fit.marksFar)Object.assign(roads.marksFar,fit.marksFar);
 if(roads.walks&&fit.walks)Object.assign(roads.walks,fit.walks);
 return fit.ground;
}
