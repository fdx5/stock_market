/** The compact textured scene is the default. Explicit comparison can opt out. */
let lastSearch:string|undefined,enabled=false;
export function textureBudgetEnabled(){
 if(typeof location==='undefined')return false;
 const search=location.search;
 if(search!==lastSearch){lastSearch=search;enabled=new URLSearchParams(search).get('sceneBudget')!=='standard';}
 return enabled;
}
