/** Single A/B switch. BVH remains enabled in both arms of this experiment. */
let search:string|undefined,enabled=true;
export function hybridSceneEnabled(){if(typeof location==='undefined')return true;if(search!==location.search){search=location.search;enabled=new URLSearchParams(search).get('hybrid')!=='off';}return enabled;}
