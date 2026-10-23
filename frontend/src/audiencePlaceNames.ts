import names from "./data/audiencePlaces.ko.json";

const regions = names.regions as Record<string, string>;
const cities = names.cities as Record<string, string>;
const countries = new Intl.DisplayNames(["ko"], { type: "region" });
const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const koreanRegions: Record<string, string> = {
  seoul: "서울특별시", busan: "부산광역시", pusan: "부산광역시", daegu: "대구광역시", taegu: "대구광역시",
  incheon: "인천광역시", inchon: "인천광역시", gwangju: "광주광역시", kwangju: "광주광역시",
  daejeon: "대전광역시", taejŏn: "대전광역시", ulsan: "울산광역시", sejong: "세종특별자치시",
  gyeonggi: "경기도", kyonggi: "경기도", gangwon: "강원특별자치도", kangwon: "강원특별자치도",
  chungcheongbuk: "충청북도", northchungcheong: "충청북도", chungbuk: "충청북도",
  chungcheongnam: "충청남도", southchungcheong: "충청남도", chungnam: "충청남도",
  jeollabuk: "전북특별자치도", northjeolla: "전북특별자치도", jeonbuk: "전북특별자치도",
  jeollanam: "전라남도", southjeolla: "전라남도", jeonnam: "전라남도",
  gyeongsangbuk: "경상북도", northgyeongsang: "경상북도", gyeongbuk: "경상북도",
  gyeongsangnam: "경상남도", southgyeongsang: "경상남도", gyeongnam: "경상남도", jeju: "제주특별자치도",
};
const usRegions: Record<string, string> = {
  alabama:"앨라배마주",alaska:"알래스카주",arizona:"애리조나주",arkansas:"아칸소주",california:"캘리포니아주",
  colorado:"콜로라도주",connecticut:"코네티컷주",delaware:"델라웨어주",florida:"플로리다주",georgia:"조지아주",
  hawaii:"하와이주",idaho:"아이다호주",illinois:"일리노이주",indiana:"인디애나주",iowa:"아이오와주",
  kansas:"캔자스주",kentucky:"켄터키주",louisiana:"루이지애나주",maine:"메인주",maryland:"메릴랜드주",
  massachusetts:"매사추세츠주",michigan:"미시간주",minnesota:"미네소타주",mississippi:"미시시피주",missouri:"미주리주",
  montana:"몬태나주",nebraska:"네브래스카주",nevada:"네바다주",newhampshire:"뉴햄프셔주",newjersey:"뉴저지주",
  newmexico:"뉴멕시코주",newyork:"뉴욕주",northcarolina:"노스캐롤라이나주",northdakota:"노스다코타주",ohio:"오하이오주",
  oklahoma:"오클라호마주",oregon:"오리건주",pennsylvania:"펜실베이니아주",rhodeisland:"로드아일랜드주",southcarolina:"사우스캐롤라이나주",
  southdakota:"사우스다코타주",tennessee:"테네시주",texas:"텍사스주",utah:"유타주",vermont:"버몬트주",
  virginia:"버지니아주",washington:"워싱턴주",westvirginia:"웨스트버지니아주",wisconsin:"위스콘신주",wyoming:"와이오밍주",
  districtofcolumbia:"워싱턴 D.C.",
};
export function audiencePlaceName(country: string, value: string, kind: "region" | "city"): string {
  if (!value || /[가-힣]/.test(value)) return value;
  const key = normalize(value);
  if (kind === "region") {
    const simplified = key.replace(/(metropolitancity|specialselfgoverningprovince|specialselfgoverningcity|specialcity|province|do|si)$/, "");
    if (country === "KR" && (koreanRegions[key] || koreanRegions[simplified])) return koreanRegions[key] || koreanRegions[simplified];
    if (country === "US" && usRegions[key]) return usRegions[key];
  }
  const dictionary = kind === "region" ? regions : cities;
  return dictionary[`${country}|${key}`] || dictionary[`${country}|${key.replace(/(si|gun)$/, "")}`] || value;
}
export function audienceRegionLabel(row: { country: string; region: string; city: string }): string {
  let country = row.country;
  try { country = row.country ? countries.of(row.country) || row.country : ""; } catch { /* Keep an unfamiliar source label. */ }
  const region = audiencePlaceName(row.country, row.region, "region");
  const city = audiencePlaceName(row.country, row.city, "city");
  const comparable = (v: string) => v.replace(/(특별자치도|특별자치시|특별시|광역시|시|도)$/, "");
  return [country, region, city && comparable(city) !== comparable(region) ? city : ""].filter(Boolean).join(" · ") || "지역 미확인";
}
