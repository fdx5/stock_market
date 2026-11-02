"""Drawing source identity, one-image work sharing, and pixel geometry. No DB or network."""
import io
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw
import pytest

from app.services import realestate_floorplans as source
from app.services.floorplan_image_analysis import analyze_image, _dimension_scale, _axis_calibration


def gallery(cid="2127", name="신도6차", region="4115010200",town="호원동"):
    rows=[]
    for tid,label,area,supply in [(6,"81B",59.9,81.19),(1,"81A",59.99,81.28)]:
        rows.append({"hscp_no":int(cid),"ptp_no":tid,"ptp_nm":label,"excls_spc":area,"sply_spc":supply,
                     "imgList":[{"ptpNo":str(tid),"imageTypeCode":"GA1","imageTypeName":"평면도 기본형","imageUrl":f"/20200528_225/test_{tid}.jpg"}]})
    return "var imgInfoData = '"+json.dumps({"rletNo":cid,"rletNm":name,"secNm":town,"cortar_no":region,"allComplexGrdPlanList":rows})+"';"


@pytest.mark.parametrize('name',['삼익 403동','삼익아파트403동','삼익 아파트 제 403 동','수서동 삼익 403동','삼익(403동)'])
def test_block_names_resolve_to_the_parent_complex(name):
    assert source.complex_name(name,'수서동')=='삼익'
    assert source.complex_name('삼익2단지 403동')=='삼익2단지'
    assert source.complex_name('목동')=='목동'
    assert source.complex_name('403동')==''


def test_same_complex_shares_catalogue_across_blocks_and_coordinates(monkeypatch):
    source._catalogues.clear();calls=[]
    def get(url,*args):
        calls.append(url);time.sleep(.01)
        if '/search/' in url:
            assert '403' not in url and '404' not in url
            return '<a href="?rletNo=668">삼익</a>'.encode(),'text/html'
        return gallery('668','삼익','1168011500','수서동').encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda row:source.catalogue(row[0],row[1],127.1,'수서동','11680'),[('삼익 403동',37.488),('삼익 404동',37.489),('삼익아파트',37.487)]))
    assert all(r['naverId']=='668' for r in results)
    assert len(calls)==2,'one public search and one original catalogue per complex'
    other=source.catalogue('삼익 403동',37.488,127.1,'도곡동','11680')
    assert other['status']=='not_found','same-name complexes in other towns must stay separate'


def test_type_id_is_not_gallery_index_and_supply_is_not_exclusive():
    result=source.parse_gallery(gallery(),"2127")
    assert [(p["typeId"],p["typeName"],p["exclusiveArea"],p["supplyArea"]) for p in result["plans"]]==[("6","81B",59.9,81.19),("1","81A",59.99,81.28)]
    assert result["plans"][0]["key"]!=result["plans"][1]["key"]
    with pytest.raises(ValueError):source.parse_gallery(gallery(),"999")


def test_legacy_gif_and_korean_filenames_are_kept_as_original_images():
    payload={"rletNo":"123","rletNm":"테스트","GRDPLAN":{"imageList":[{"ptpNo":"2","ptpNm":"59A","excluseSpace":"59.97","supplySpace":"81.2","imageTypeCode":"GA1","imageUrl":"/20010101_1/기본형.gif?type=w400"}]}}
    result=source.parse_gallery("var imgInfoData = '"+json.dumps(payload)+"';","123")
    assert result["plans"][0]["exclusiveArea"]==59.97
    assert result["plans"][0]["imageUrl"].endswith("/%EA%B8%B0%EB%B3%B8%ED%98%95.gif")
    assert "type=w400" not in result["plans"][0]["imageUrl"]


def test_ambiguous_search_link_is_parsed_without_executing_javascript(monkeypatch):
    source._catalogues.clear()
    body='<a onclick="nhn.rels.search.common.reSearchComplexTab(\'encoded\',\'2127\');return false;">신도6차</a>'
    calls=[]
    def get(url,*args):
        calls.append(url)
        return (body if "/search/" in url else gallery()).encode(),"text/html"
    monkeypatch.setattr(source,"_get",get)
    result=source.catalogue("신도6차",37.726955,127.038392,"호원동","41150")
    assert result["naverId"]=="2127" and len(calls)==2
    assert not any("landthumb" in u for u in calls) # metadata does not download every type
    assert source.catalogue("신도6차",37.726955,127.038392,"호원동","11680")["status"]=="not_found"


@pytest.mark.parametrize('name',['신도6','신도(6차)','신도 제6차','호원신도6차','신도6차 601동'])
def test_phase_notation_matches_the_same_complex(name):
    assert source._same_name(name,'신도6차','호원동')
    assert not source._same_name(name,'신도6-1차','호원동')
    assert not source._same_name(name,'신도61차','호원동')
    assert not source._same_name(name,'신도4차','호원동')
    assert not source._same_name('신도101','신도101차','호원동')
    assert not source._same_name('주공1차','주공1단지','호원동')
    assert source._same_name('I-PARK','호원아이파크','호원동')
    assert source._same_name('신일엘리시움','신일엘리시움(주상복합)','호원동')
    assert not source._same_name('신일엘리시움(임대)','신일엘리시움(분양)','호원동')


def test_missing_phase_word_retries_source_queries_without_losing_subphases(monkeypatch):
    from urllib.parse import parse_qs,urlparse
    source._catalogues.clear();queries=[]
    def get(url,*args):
        if '/search/' in url:
            q=parse_qs(urlparse(url).query)['query'][0];queries.append(q)
            body='<a href="?rletNo=25813">신도6-1차</a>'
            if q.endswith('신도6차') or q.endswith('신도'):body+='<a href="?rletNo=2127">신도6차</a>'
            return body.encode(),'text/html'
        return gallery().encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    r=source.catalogue('신도6',37.726955,127.038392,'호원동','41150')
    assert r['naverId']=='2127' and r['matchedBy']=='phase_or_town_label'
    assert queries[:2]==['호원동 신도6','호원동 신도6차']
    assert len(queries)<=4
    assert source._identity_name('신도6-1')!=source._identity_name('신도61')


def test_one_broken_candidate_does_not_abort_other_original_catalogues(monkeypatch):
    source._catalogues.clear()
    monkeypatch.setattr(source,'_get',lambda *args:('<a href="?rletNo=111">삼익</a><a href="?rletNo=668">삼익</a>'.encode(),'text/html'))
    def lookup(cid):
        if cid=='111':raise LookupError('expired source')
        return source.parse_gallery(gallery('668','삼익','1168011500','수서동'),'668')
    monkeypatch.setattr(source,'_gallery',lookup)
    assert source.catalogue('삼익',37.488,127.1,'수서동','11680')['naverId']=='668'


def test_bare_number_does_not_choose_between_distinct_phase_and_complex_labels(monkeypatch):
    source._catalogues.clear()
    monkeypatch.setattr(source,'_get',lambda *args:('<a href="?rletNo=10">주공1차</a><a href="?rletNo=11">주공1단지</a>'.encode(),'text/html'))
    monkeypatch.setattr(source,'_gallery',lambda cid:source.parse_gallery(gallery(cid,'주공1차' if cid=='10' else '주공1단지'),'10' if cid=='10' else '11'))
    assert source.catalogue('주공1',37.726955,127.038392,'호원동','41150')['status']=='ambiguous'


def test_only_selected_image_downloaded_once_even_with_concurrent_requests(monkeypatch):
    source._images.clear()
    plans=source.parse_gallery(gallery(),"2127")
    monkeypatch.setattr(source,"_gallery",lambda cid:plans)
    calls=[]
    def get(url,*args):
        calls.append(url);time.sleep(.04);return b"test-image","image/jpeg"
    monkeypatch.setattr(source,"_get",get)
    key=plans["plans"][0]["key"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(lambda _:source.image("2127",key),range(6)))
    assert results==[(b"test-image","image/jpeg")]*6
    assert calls==[plans["plans"][0]["imageUrl"]]
    with pytest.raises(LookupError):source.selected("2127","0"*24)


@pytest.mark.parametrize("url",["http://landthumb-phinf.pstatic.net/x.jpg","https://127.0.0.1/x.jpg","https://landthumb-phinf.pstatic.net.evil.example/x.jpg","https://land.naver.com:8443/x"])
def test_image_proxy_cannot_fetch_arbitrary_hosts(url):
    with pytest.raises(ValueError):source._get(url)


def drawn_flat(split=300):
    image=Image.new("RGB",(800,640),"white");d=ImageDraw.Draw(image)
    d.rectangle((100,100,640,520),fill="#c99852",outline="black",width=6)
    d.rectangle((100,300,split,520),fill="#f2e3b4",outline="black",width=6)
    d.rectangle((450,100,640,300),fill="#f2e3b4",outline="black",width=6)
    d.rectangle((220,296,280,305),fill="#c99852")
    d.rectangle((446,210,456,270),fill="#c99852")
    d.rectangle((split-4,360,split+5,420),fill="#c99852")
    data=io.BytesIO();image.save(data,format="PNG")
    words=[{"text":text,"x":x,"y":y,"w":20,"h":12,"confidence":98,"rotation":rotation} for text,x,y,rotation in [
        ("9000",370,50,0),("7000",690,310,90),("거실",230,200,0),("주방식당",460,410,0),("침실",200,410,0),("침실",550,200,0)]]
    return data.getvalue(),words


def test_geometry_comes_from_pixels_and_numeric_dimension_evidence():
    a,words=drawn_flat();b,words_b=drawn_flat(320)
    first=analyze_image(a,63,words=words);second=analyze_image(b,63,words=words_b)
    assert first["status"]=="ready",first.get("reason")
    assert second["status"]=="ready",second.get("reason")
    assert first["scale"]["basis"]=="recognized_dimensions"
    assert first["rooms"]!=second["rooms"]
    assert sum(r["type"] in ("master","bedroom") for r in first["rooms"])==2
    for i,r in enumerate(first["rooms"]):
        a,b,c,d=r["rect"]
        assert c>a and d>b
        for q in first["rooms"][i+1:]:
            e,f,g,h=q["rect"]
            assert max(0,min(c,g)-max(a,e))*max(0,min(d,h)-max(b,f))<1e-5


def test_unreadable_or_conflicting_drawings_never_become_standard_84():
    data,words=drawn_flat()
    assert analyze_image(data,63,words=[]) ["status"]=="needs_review"
    wrong=[{**w,"text":"20000"} if w["rotation"]==90 else w for w in words]
    assert analyze_image(data,63,words=wrong)["reason"]=="dimension_conflict"
    blank=io.BytesIO();Image.new("RGB",(800,640),"white").save(blank,format="PNG")
    assert analyze_image(blank.getvalue(),63,words=words)["status"]=="needs_review"


def test_dimension_uses_its_tick_span_and_combines_chain_lengths():
    import numpy as np
    gray=np.full((640,800),255,np.uint8)
    gray[50,100:651]=0
    for x in [100,300,650]:gray[45:56,x]=0
    gray[25,100:651]=0
    for x in [100,650]:gray[20:31,x]=0
    total={"millimetres":11000,"text":"11000","x":375.,"y":12.,"rotation":0,"confidence":99}
    assert abs(_dimension_scale(total,gray,"x",(80,100,700,600))-.02)<1e-6
    words=[total,{"millimetres":4000,"x":200.,"y":36.,"rotation":0,"confidence":99},{"millimetres":7000,"x":475.,"y":36.,"rotation":0,"confidence":99}]
    measure,evidence=_axis_calibration(words,gray,"x",(80,100,700,600),.02)
    assert len(evidence)>=3
    assert abs(measure(300)-measure(100)-4)<.05
    assert abs(measure(650)-measure(300)-7)<.05

    # A real drawing may show only these two adjacent segments, with no total.
    measure,evidence=_axis_calibration(words[1:],gray,"x",(80,100,700,600),.02)
    assert len(evidence)==2
    assert abs(measure(300)-measure(100)-4)<.05
    assert abs(measure(650)-measure(300)-7)<.05


def test_expanded_source_retains_service_area_without_stretching_to_exclusive():
    data,words=drawn_flat()
    ordinary=analyze_image(data,50,words=words)
    expanded=analyze_image(data,50,words=words,expanded=True,supply_area=68)
    assert ordinary["status"]=="ready",'a moderate area difference does not block a matched source structure'
    assert not ordinary['checks']['areaConsistent']
    assert ordinary['scale']['estimated'] is False,'observed dimensions must not be stretched to force area equality'
    assert expanded["status"]=="ready",expanded.get("reason")
    assert expanded["areaBasis"]=="expanded_drawing"
    assert expanded["areaM2"]>50*1.18
    assert expanded["rooms"]==ordinary["rooms"]
    bounded=analyze_image(data,50,words=words,expanded=True,supply_area=51)
    assert bounded['status']=='ready'
    assert bounded['areaBasis']!='expanded_drawing','an inconsistent supply envelope must not be presented as validated expansion'
    assert bounded['application']['mode']=='approximate_source'



def test_homonymous_town_falls_back_to_name_then_verifies_the_actual_town(monkeypatch):
    from urllib.parse import parse_qs,urlparse
    source._catalogues.clear();queries=[]
    def get(url,*args):
        if '/search/' not in url:return gallery('110837','동탄역포레너스','4159710600','영천동').encode(),'text/html'
        q=parse_qs(urlparse(url).query)['query'][0];queries.append(q)
        if q.startswith('영천동'):return b'baseQueryResult = {};','text/html'
        d={'complexCode':'110837','complexName':'동탄역포레너스','complexMapXCrdn':'127.116928','complexMapYCrdn':'37.205961','cortarInfo':{'secNm':'영천동','cortarNo':'4159710600'}}
        return ('baseQueryResult = '+json.dumps(d)+';').encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    r=source.catalogue('동탄역포레너스',37.205961,127.116928,'영천동','41590')
    assert r['naverId']=='110837' and r['locationMatchedBy']=='source_coordinates'
    assert queries==['영천동 동탄역포레너스','동탄역포레너스']
    # A cache admitted using source coordinates must not match a distant namesake.
    assert source.catalogue('동탄역포레너스',37.57,126.96,'영천동','41590')['status']=='not_found'
    assert source.catalogue('동탄역포레너스',37.205961,127.116928,'영천동','41590')['naverId']=='110837'


def test_apartment_and_officetel_catalogues_at_the_same_address_stay_separate(monkeypatch):
    source._catalogues.clear()
    monkeypatch.setattr(source,'_get',lambda *a:('<a href="?rletNo=119632">대방(주상복합)</a><a href="?rletNo=119633">대방</a>'.encode(),'text/html'))
    def lookup(cid):
        g=source.parse_gallery(gallery(cid,'대방(주상복합)' if cid=='119632' else '대방','4159710600','영천동'),cid)
        return {**g,'propertyType':'A01' if cid=='119632' else 'A02'}
    monkeypatch.setattr(source,'_gallery',lookup)
    r=source.catalogue('대방',37.2,127.1,'영천동','41597')
    assert r['naverId']=='119632' and r['propertyType']=='A01'


def test_a_failed_town_query_does_not_cancel_the_name_retry(monkeypatch):
    source._catalogues.clear();calls=[]
    def get(url,*a):
        calls.append(url)
        if len(calls)==1:raise LookupError('source temporarily unavailable')
        return '<a href="?rletNo=668">삼익</a>'.encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    monkeypatch.setattr(source,'_gallery',lambda cid:source.parse_gallery(gallery('668','삼익','1168011500','수서동'),'668'))
    assert source.catalogue('삼익',37.488,127.1,'수서동','11680')['naverId']=='668'



def test_dimension_area_conflict_uses_original_pixel_ratios_without_replacing_walls():
    data,words=drawn_flat()
    a=analyze_image(data,35,words=words)
    assert a['status']=='ready' and a['application']['dimensionScaleAdjusted']
    assert a['scale']['estimated'] and a['scale']['basis']=='exclusive_area_ratio'
    assert a['application']['geometryBasis']=='original_image' and not a['application']['templateUsed']
    assert abs(a['areaM2']-35)<.01
    ratio=a['scale']['xMetresPerPixel'];assert ratio==a['scale']['zMetresPerPixel']
    for room,pixel in zip(a['rooms'],a['pixelRooms']):
        width=room['rect'][2]-room['rect'][0];height=room['rect'][3]-room['rect'][1]
        assert abs(width-(pixel['rect'][2]-pixel['rect'][0])*ratio)<.0002
        assert abs(height-(pixel['rect'][3]-pixel['rect'][1])*ratio)<.0002
    ids={r['id']:r for r in a['rooms']}
    for opening in a['openings']:
        r=ids[opening['a']];j=0 if opening['axis']=='x' else 1
        assert min(abs(opening['at']-r['rect'][j]),abs(opening['at']-r['rect'][j+2]))<.002


def test_eup_myeon_complex_matches_source_labelled_by_the_eup_alone(monkeypatch):
    # Our id carries "문산읍 당동리"; the source names the town "문산읍".
    source._catalogues.clear()
    def get(url,*args):
        if '/search/' in url:return '<a href="?rletNo=108512">파주한양수자인리버팰리스</a>'.encode(),'text/html'
        return gallery('108512','파주한양수자인리버팰리스','4148025000','문산읍').encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    found=source.catalogue('파주한양수자인리버팰리스',37.8656,126.7737,'문산읍 당동리','41480')
    assert found['status']=='available' and found['naverId']=='108512'
    assert source.catalogue('파주한양수자인리버팰리스',37.8656,126.7737,'파주읍 봉암리','41480')['status']=='not_found'
    assert not source._same_town('당동','문산읍 당동리')


def test_presale_right_id_without_a_town_matches_by_name_and_region(monkeypatch):
    source._catalogues.clear();urls=[]
    def get(url,*args):
        urls.append(url)
        if '/search/' in url:return '<a href="?rletNo=555">운정신도시자이</a>'.encode(),'text/html'
        return gallery('555','운정신도시자이','4148011000','동패동').encode(),'text/html'
    monkeypatch.setattr(source,'_get',get)
    found=source.catalogue('운정신도시자이',37.72,126.75,'rights','41480')
    assert found['status']=='available' and found['naverId']=='555'
    assert not any('rights' in u for u in urls)
