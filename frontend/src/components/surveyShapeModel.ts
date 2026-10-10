import type {PhotoBuilding} from './vworld3d';

/** Geometry only: neither image names, photographic UVs nor photo bytes enter
 * the drone's facade worker. Exterior materials are constructed separately. */
export type SurveyShapeModel={key:string;position:Float32Array;index:Uint32Array;ox:number;oy:number;ground:number;cx:number;cy:number;hull:[number,number][]};
export function surveyShapeModel(model:PhotoBuilding,ox:number,oy:number,ground:number):SurveyShapeModel{
  return {key:model.key,position:model.geometry.getAttribute('position').array as Float32Array,
    index:new Uint32Array(model.geometry.index!.array),ox,oy,ground,cx:model.cx,cy:model.cy,hull:model.hull};
}
