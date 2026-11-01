/** Apartment drawings belong to a complex, while units/floors belong to a block. */
export function apartmentName(value:string,town=''){
 let name=value.normalize('NFKC').trim();
 name=name.replace(/\(\s*(?:제\s*)?(?:\d{1,4}|[A-Z가-힣])\s*동\s*\)\s*$/i,'');
 name=name.replace(/\s*(?:제\s*)?(?:\d{1,4}|[A-Z])\s*동(?:\s*\d{1,4}\s*호)?\s*$/i,'').replace(/\s+[가-힣]\s*동\s*$/,'');
 name=name.replace(/아파트|\bAPT\b/gi,'').replace(/\s+/g,' ').trim();
 if(town&&name.startsWith(town))name=name.slice(town.length).trim();
 return name;
}
export const apartmentBlock=(name:string)=>name.match(/(?:제\s*)?(?:\d{1,4}|[A-Z])\s*동(?:\s*\))?\s*$/i)?.[0].replace(/[()\s]|^제/g,'')??'';
export function drawingLookupIdentity(name:string,town:string,region:string,lat:number,lon:number){
 const place=town&&region?`${town}|${region}`:`${lat.toFixed(5)}|${lon.toFixed(5)}|${town}|${region}`;
 return `${apartmentName(name,town).toUpperCase().replace(/\s/g,'')}|${place}`;
}
