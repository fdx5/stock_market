/** Shared by the initial view and the serialized tile worker. Keep self-contained. */
export function namedBuildingKind(name: string, use: string, floors: number, height: number) {
  const n=name.trim().replace(/\s+/g,' ');
  if(n.length<2||/^(\d+|[가-힣]?동|.*주택|근생.*|다세대.*|연립.*|단독.*|상가|창고|화장실|관리동|경비실|주차장|기계실|부속.*|.*근린생활시설)$/.test(n))return null;
  if(/(구청|시청|군청|도청|청사|주민센터|행정복지센터|동사무소|경찰서|지구대|파출소|소방서|안전센터|우체국|법원|검찰청|세무서|교육청|교육지원청|보건소|구의회|시의회|도서관|병무청|출입국|등기소)/.test(n))return 'gov';
  if(/(먹자골목|먹거리거리|음식문화거리|특화거리|카페거리|부대찌[개게]거리|닭갈비골목|족발거리|순대타운|차이나타운|한옥마을|벽화마을)/.test(n))return 'district';
  if(/(전통시장|재래시장|[가-힣A-Za-z]시장)(?:\s|\(|$)/.test(n)||use==='marketplace')return 'market';
  const shop=/(백화점|아울렛|아웃렛|쇼핑몰|쇼핑센터|스타필드|코스트코|Costco|홈플러스|Homeplus|롯데마트|트레이더스|하나로마트|메가마트|AK플라자|NC백화점|뉴코아)/i.test(n)
    ||(/이마트|E[ -]?Mart/i.test(n)&&!/(이마트\s*24|emart\s*24)/i.test(n));
  if(shop||/^07/.test(use)||/^(department_store|mall|wholesale)$/.test(use))return 'commercial';
  if(/^02/.test(use)&&floors>=7)return 'apt';
  if(/^09/.test(use)||/병원|의료원/.test(n))return floors>=4?'hospital':null;
  if(/^10/.test(use)&&/(대학교|대학|고등학교|중학교|초등학교|학교)/.test(n))return 'school';
  if(/^(train_station|station|transportation)$/.test(use)||(/^08/.test(use)&&/역(?:사|$)|터미널/.test(n)))return 'station';
  return floors>=20||height>=60?'major':null;
}
