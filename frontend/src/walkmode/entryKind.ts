import {apartmentBlock} from './apartmentIdentity';
import {apartmentName} from './apartmentIdentity';
import {complexOf,type VisitedComplex} from './complexOf';

export interface EntryEvidence {name?:string|null;kind?:'apartment'|'building';use?:string|null;useLabel?:string|null;dong?:string|null;complexId?:string|null}
const collected=(id?:string|null)=>/^\d{5}:[^:]+:[^:]+:.+/.test(id??'');
const facilityUse=/근린|업무|의료|교육|종교|판매|운수|숙박|공장|창고|공공|문화|운동|단독주택/;
const accessory=/관리사무소|관리동|경비실|상가|주차장|기계실|어린이집/;
const facilityName=/병원|의원|의료원|학교|대학|구청|시청|도청|군청|주민센터|도서관|백화점|호텔|박물관|미술관|경찰서|소방서|우체국|법원/;
/** Classify from positive evidence. Missing register fields are not evidence of
 * a public/commercial building; apartment signs do not depend on floor counts. */
export function entryKind(entry:EntryEvidence,register?:{name?:string|null;use?:string|null;useDetail?:string|null}){
 if(entry.kind==='apartment'||collected(entry.complexId))return 'apartment' as const;
 const names=`${entry.name??''} ${register?.name??''}`;
 if(accessory.test(names))return 'building' as const;
 const use=`${register?.use??''} ${register?.useDetail??''} ${entry.useLabel??''}`;
 if(/^02/.test(entry.use??'')||/공동주택|아파트|연립|다세대/.test(use))return 'apartment' as const;
 // A building card's own kind (a hospital, a school, a store sign) and a facility's name outrank a
 // block label: a hospital's "신관" in the dong field is not a block of flats.
 if((entry.kind==='building'||facilityName.test(names))&&!/아파트|\bAPT\b/i.test(names)&&!apartmentBlock(entry.name??''))return 'building' as const;
 if(/아파트|\bAPT\b/i.test(names)||apartmentBlock(entry.name??'')||entry.dong)return 'apartment' as const;
 if(facilityUse.test(use)||facilityName.test(names)||entry.kind==='building')return 'building' as const;
 return 'unknown' as const;
}

/** An untyped old drone link can still recover its apartment through the same
 * collected complex/parcel lookup used by the unit chooser. No name allowlist. */
export async function resolveEntryKind(entry:EntryEvidence,register:{name?:string|null;use?:string|null;useDetail?:string|null}|undefined,pnu:string|null,town=''):Promise<{kind:'apartment'|'building'|'unknown';complex?:VisitedComplex}>{
 const kind=entryKind(entry,register);
 if(kind==='apartment')return {kind};
 const use=`${register?.use??''} ${register?.useDetail??''} ${entry.useLabel??''}`;
 if(facilityUse.test(use)||accessory.test(`${entry.name??''} ${register?.name??''}`)||facilityName.test(`${entry.name??''} ${register?.name??''}`))return {kind:'building'};
 if(pnu){
  const raw=apartmentName(entry.name??register?.name??'',town);
  const name=/^(건물|주건축물|공동주택|아파트)$/.test(raw)?'':raw;
  const complex=await complexOf(name,pnu,AbortSignal.timeout(6000),town).catch(()=>null);
  if(complex)return {kind:'apartment',complex};
 }
 return {kind};
}
