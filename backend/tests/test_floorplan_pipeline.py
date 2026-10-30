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


def gallery(cid="2127", name="신도6차", region="4115010200"):
    rows=[]
    for tid,label,area,supply in [(6,"81B",59.9,81.19),(1,"81A",59.99,81.28)]:
        rows.append({"hscp_no":int(cid),"ptp_no":tid,"ptp_nm":label,"excls_spc":area,"sply_spc":supply,
                     "imgList":[{"ptpNo":str(tid),"imageTypeCode":"GA1","imageTypeName":"평면도 기본형","imageUrl":f"/20200528_225/test_{tid}.jpg"}]})
    return "var imgInfoData = '"+json.dumps({"rletNo":cid,"rletNm":name,"secNm":"호원동","cortar_no":region,"allComplexGrdPlanList":rows})+"';"


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
