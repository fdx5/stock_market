import type {Drawing} from './interior/plan/imagePlan';

/** Only small recording/rounding differences can select a type automatically.
 * Distinct A/B types with the same area still require an explicit choice. */
export function drawingSelection(plans:Drawing[],area:number|undefined,selected:string){
 const exact=plans.filter(p=>area!==undefined&&Math.abs(p.exclusiveArea-area)<=.005);
 const near=exact.length?exact:plans.filter(p=>area!==undefined&&Math.abs(p.exclusiveArea-area)<=.15);
 const matches=area===undefined?plans:near;
 const severalTypes=area!==undefined&&new Set(matches.map(p=>p.typeId)).size>1;
 const chosen=matches.find(p=>p.key===selected)??(severalTypes?undefined:matches[0]);
 return {matches,severalTypes,chosen};
}
