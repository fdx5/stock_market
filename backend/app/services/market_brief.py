import datetime as dt, logging, threading, time
from collections import defaultdict
from zoneinfo import ZoneInfo
from app.data import index_fetcher, news_fetcher
from app.services import market_brief_store
from app.services.market_map import get_kospi_map,get_kosdaq_map

KST=ZoneInfo("Asia/Seoul"); log=logging.getLogger(__name__); _lock=threading.Lock()
def _num(v):
    try:return float(v or 0)
    except:return 0.0
def generate(market:str,force=False):
    market=market.upper(); symbol=market; now=dt.datetime.now(KST); index=index_fetcher.get_index(symbol,fresh=True) or index_fetcher.get_index(symbol) or {}
    day=(str(index.get("updated_at") or now.date()))[:10]
    if not force:
        old=market_brief_store.get(day,market)
        if old:return old
    items=(get_kospi_map(500, fresh=True) if market=="KOSPI" else get_kosdaq_map(200,fresh=True))
    adv=sum(_num(x.get("change_pct"))>0 for x in items); dec=sum(_num(x.get("change_pct"))<0 for x in items); flat=len(items)-adv-dec
    turnover=sum(_num(x.get("close"))*_num(x.get("volume")) for x in items)
    top_up=sorted(items,key=lambda x:_num(x.get("change_pct")),reverse=True)[:8]; top_down=sorted(items,key=lambda x:_num(x.get("change_pct")))[:8]
    active=sorted(items,key=lambda x:_num(x.get("close"))*_num(x.get("volume")),reverse=True)[:8]
    sectors=defaultdict(lambda:{"cap":0.0,"weighted":0.0,"count":0})
    for x in items:
        s=sectors[str(x.get("sector") or "기타")]; cap=_num(x.get("marcap"));s["cap"]+=cap;s["weighted"]+=cap*_num(x.get("change_pct"));s["count"]+=1
    sector_rows=[{"name":k,"change_pct":round(v["weighted"]/v["cap"],2) if v["cap"] else 0,"marcap":v["cap"],"count":v["count"]} for k,v in sectors.items()]
    sector_rows.sort(key=lambda x:x["change_pct"],reverse=True)
    investor=index_fetcher.get_market_investor_summary(symbol,fresh=True) or index_fetcher.get_market_investor_summary(symbol) or {}
    headlines=[]
    for stock in active[:4]:
        try:
            for n in news_fetcher.get_news(stock["code"],2):
                title=n.get("title") or n.get("headline")
                if title and title not in [h["title"] for h in headlines]:headlines.append({"title":title,"url":n.get("url") or n.get("link"),"stock":stock["name"]})
        except Exception:pass
    pct=_num(index.get("change_pct")); breadth=adv/max(1,adv+dec)*100; foreign=_num(investor.get("foreign_amount")); inst=_num(investor.get("institution_amount"))
    tone="강세" if pct>=1 else "상승" if pct>0 else "약세" if pct<=-1 else "하락" if pct<0 else "보합"
    driver="외국인과 기관의 동반 순매수" if foreign>0 and inst>0 else "외국인 순매수" if foreign>0 else "기관 순매수" if inst>0 else "외국인·기관 동반 순매도"
    payload={"date":day,"market":market,"created_at":now.isoformat(timespec="seconds"),"index":index,"investor":investor,"breadth":{"advance":adv,"decline":dec,"flat":flat,"advance_ratio":round(breadth,1)},"turnover_estimate":turnover,"top_up":top_up,"top_down":top_down,"active":active,"sectors":sector_rows[:10],"headlines":headlines[:8],"summary":f"{market}는 {pct:+.2f}% {tone} 마감했습니다. 상승 종목 비중은 {breadth:.1f}%였으며 수급의 핵심은 {driver}였습니다.","analysis":[f"지수는 {index.get('close',0):,.2f}로 마감해 전일 대비 {index.get('change',0):+,.2f}포인트({pct:+.2f}%) 움직였습니다.",f"상승 {adv}개, 하락 {dec}개, 보합 {flat}개로 시장 확산도는 {breadth:.1f}%입니다.",f"외국인 {foreign:+,.0f}억원, 기관 {inst:+,.0f}억원, 개인 {_num(investor.get('individual_amount')):+,.0f}억원의 순매매를 기록했습니다.",f"추정 거래대금은 {turnover/1e12:,.1f}조원이며 {sector_rows[0]['name'] if sector_rows else '주요 업종'}이 상대 강세를 보였습니다."],"disclaimer":"본 리포트는 공개 시장 데이터를 자동 집계한 투자 참고 자료이며 투자 권유가 아닙니다. 가격과 수급은 제공처 사정에 따라 지연·정정될 수 있습니다."}
    market_brief_store.save(day,market,payload,now.isoformat());return payload
def run_all(force=False):
    with _lock:return {m:generate(m,force) for m in ("KOSPI","KOSDAQ")}
def _loop():
    done=""
    while True:
        now=dt.datetime.now(KST); key=now.date().isoformat()
        if now.weekday()<5 and now.time()>=dt.time(16,10) and done!=key:
            try:run_all();done=key
            except Exception:log.exception("market brief batch failed")
        time.sleep(300)
def start_scheduler():threading.Thread(target=_loop,daemon=True,name="market-brief-batch").start()
