/** Apartment drawings belong to a complex, while units/floors belong to a block. */
export function apartmentName(value:string,town='',blockHint=''){
 let name=value.normalize('NFKC').trim();
 const block=blockHint.replace(/^제|\s|동/g,'');
 if(/^\d{1,4}$/.test(block)&&name.endsWith(block)&&!/[0-9]/.test(name[name.length-block.length-1]??''))name=name.slice(0,-block.length).trim();
 name=name.replace(/\(\s*(?:제\s*)?(?:\d{1,4}|[A-Z가-힣])\s*동\s*\)\s*$/i,'');
 name=name.replace(/\s*(?:제\s*)?(?:\d{1,4}|[A-Z])\s*동(?:\s*\d{1,4}\s*호)?\s*$/i,'').replace(/\s+[가-힣]\s*동\s*$/,'');
 name=name.replace(/아파트|\bAPT\b/gi,'').replace(/\s+/g,' ').trim();
 if(town&&name.startsWith(town))name=name.slice(town.length).trim();
 return name;
}
export const apartmentBlock=(name:string)=>name.match(/(?:제\s*)?(?:\d{1,4}|[A-Z])\s*동(?:\s*\))?\s*$/i)?.[0].replace(/[()\s]|^제/g,'')??'';
export const normaliseBlock=(value:string)=>{const id=value.replace(/^제|\s|동/g,'');return /^(?:\d{1,4}|[A-Z가-힣])$/.test(id)?id+'동':value;};
export function entryComplexId(name:string,block:string,id?:string){
 if(!id||!/^\d{5}:[^:]+:[^:]+:.+/.test(id))return undefined;
 const norm=(s:string)=>apartmentName(s,id.split(':')[1],block).replace(/에스에이치/gi,'SH').replace(/엘에이치/gi,'LH').toUpperCase().replace(/\s|[()]/g,'');
 return !name||norm(name)===norm(id.split(':').slice(3).join(':'))?id:undefined;
}
export function drawingLookupIdentity(name:string,town:string,region:string,lat:number,lon:number){
 const place=town&&region?`${town}|${region}`:`${lat.toFixed(5)}|${lon.toFixed(5)}|${town}|${region}`;
 return `${apartmentName(name,town).toUpperCase().replace(/\s/g,'')}|${place}`;
}
