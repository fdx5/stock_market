export interface BuildingPlace { name:string;kind:string;category:string|null;lat:number;lon:number;floor?:number|null }
export type BuildingCategory="hospital"|"shop"|"department"|"public"|"museum"|"station"|"office"|"school"|"mart";
export const CATEGORY:Record<BuildingCategory,{label:string;color:string,use:string}>={
  hospital:{label:"병원",color:"#ff8fa8",use:"의료시설"},shop:{label:"상가",color:"#ffd270",use:"판매시설"},department:{label:"백화점",color:"#e6a2ff",use:"백화점 판매시설"},public:{label:"공공기관",color:"#8cbdff",use:"공공 업무시설"},station:{label:"지하철",color:"#77ffae",use:"지하철 운수시설"},office:{label:"빌딩",color:"#75eeff",use:"업무시설"},
  museum:{label:"박물관",color:"#d5b9ff",use:"박물관 문화집회시설"},
  school:{label:"학교",color:"#9be38a",use:"교육연구시설"},mart:{label:"대형마트",color:"#ffb36b",use:"대규모 판매시설"},
};
export function categoryOf(name:string,use="",kind=""):BuildingCategory{
  const s=`${name} ${use} ${kind}`;
  if(/병원|의원|의료|보건|clinic|^09/.test(s)||/^09/.test(use))return "hospital";
  if(/백화점|쇼핑몰|아울렛|복합쇼핑/.test(s))return "department";
  if(/이마트|홈플러스|롯데마트|코스트코|트레이더스|하나로마트|대형마트|농협하나로/.test(s))return "mart";
  if(/(초등|중|고등|대)학교|학교$|대학교|캠퍼스/.test(s)||/^10/.test(use))return "school";
  if(/박물관|미술관|전시관|과학관|기념관|museum/.test(s))return "museum";
  if(/지하철|전철|station|역사|철도/.test(s)||/역$/.test(name)||/^07/.test(use))return "station";
  if(/주민센터|행정복지|구청|시청|공공|경찰|파출소|소방|우체국|보건소|public/.test(s))return "public";
  if(/상가|판매|근린|마트|쇼핑|store|food|cafe|mart|pharmacy/.test(s)||/^0[3456]/.test(use))return "shop";
  return "office";
}
