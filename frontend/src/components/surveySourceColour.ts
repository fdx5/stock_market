/** Keep the surveyed replacement's exact coarse wall/roof evidence. Run after
 * appearance construction and vertex deduplication, as the former page-side
 * painting did; the separate facade/UV attributes remain untouched. */
export function paintSurveySourceColour(color:Float32Array,surface:number,tints:Float32Array|undefined){
 if(!tints)return;
 const offset=surface===1?3:0,scale=surface===2?.86:1;
 const r=tints[offset],g=tints[offset+1],b=tints[offset+2];
 if(!Number.isFinite(r)||!Number.isFinite(g)||!Number.isFinite(b))return;
 for(let i=0;i<color.length;i+=3){color[i]=r*scale;color[i+1]=g*scale;color[i+2]=b*scale;}
}
