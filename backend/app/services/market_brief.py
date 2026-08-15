import datetime as dt
import logging
import threading
import time
from collections import defaultdict
from zoneinfo import ZoneInfo

from app.data import index_fetcher, news_fetcher
from app.services import market_brief_store
from app.services.market_map import get_kosdaq_map, get_kospi_map

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)
_lock = threading.Lock()
REPORT_VERSION = 2


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def generate(market: str, force: bool = False):
    market = market.upper()
    now = dt.datetime.now(KST)
    index = index_fetcher.get_index(market, fresh=True) or index_fetcher.get_index(market) or {}
    day = str(index.get("updated_at") or now.date())[:10]
    if not force:
        old = market_brief_store.get(day, market)
        if old and old.get("version", 1) >= REPORT_VERSION:
            return old

    items = get_kospi_map(500, fresh=True) if market == "KOSPI" else get_kosdaq_map(200, fresh=True)
    advance = sum(_num(x.get("change_pct")) > 0 for x in items)
    decline = sum(_num(x.get("change_pct")) < 0 for x in items)
    flat = len(items) - advance - decline
    breadth = advance / max(1, advance + decline) * 100
    turnover = sum(_num(x.get("close")) * _num(x.get("volume")) for x in items)
    top_up = sorted(items, key=lambda x: _num(x.get("change_pct")), reverse=True)[:8]
    top_down = sorted(items, key=lambda x: _num(x.get("change_pct")))[:8]
    active = sorted(items, key=lambda x: _num(x.get("close")) * _num(x.get("volume")), reverse=True)[:8]
    top3_share = sum(_num(x.get("close")) * _num(x.get("volume")) for x in active[:3]) / max(1, turnover) * 100

    sectors = defaultdict(lambda: {"cap": 0.0, "weighted": 0.0, "count": 0})
    for item in items:
        row = sectors[str(item.get("sector") or "기타")]
        cap = _num(item.get("marcap"))
        row["cap"] += cap
        row["weighted"] += cap * _num(item.get("change_pct"))
        row["count"] += 1
    sector_rows = [{"name": name, "change_pct": round(v["weighted"] / v["cap"], 2) if v["cap"] else 0,
                    "marcap": v["cap"], "count": v["count"]} for name, v in sectors.items()]
    sector_rows.sort(key=lambda x: x["change_pct"], reverse=True)

    investor = index_fetcher.get_market_investor_summary(market, fresh=True) or index_fetcher.get_market_investor_summary(market) or {}
    foreign = _num(investor.get("foreign_amount"))
    institution = _num(investor.get("institution_amount"))
    individual = _num(investor.get("individual_amount"))
    headlines = []
    for stock in active[:4]:
        try:
            for news in news_fetcher.get_news(stock["code"], 2):
                title = news.get("title") or news.get("headline")
                if title and title not in {h["title"] for h in headlines}:
                    headlines.append({"title": title, "url": news.get("url") or news.get("link"), "stock": stock["name"]})
        except Exception:
            pass

    pct = _num(index.get("change_pct"))
    tone = "강세" if pct >= 1 else "상승" if pct > 0 else "약세" if pct <= -1 else "하락" if pct < 0 else "보합"
    driver = "외국인과 기관의 동반 순매수" if foreign > 0 and institution > 0 else "외국인 순매수" if foreign > 0 else "기관 순매수" if institution > 0 else "외국인·기관 동반 순매도"
    best_sector = sector_rows[0] if sector_rows else {"name": "주요 업종", "change_pct": 0}
    weak_sector = sector_rows[-1] if sector_rows else {"name": "주요 업종", "change_pct": 0}
    leader_names = ", ".join(x.get("name", "") for x in active[:3])
    analysis = [
        f"지수는 {index.get('close', 0):,.2f}로 마감해 전일 대비 {index.get('change', 0):+,.2f}포인트({pct:+.2f}%) 움직였습니다. 종가 방향은 {tone}로 분류되며 장중 가격보다 종가에서 확인된 방향성을 우선 평가했습니다.",
        f"시장 내부에서는 상승 {advance}개, 하락 {decline}개, 보합 {flat}개를 기록했습니다. 상승 종목 비중 {breadth:.1f}%는 지수 움직임이 일부 대형주에 국한됐는지, 다수 종목으로 확산됐는지를 판단하는 핵심 지표입니다.",
        f"수급은 외국인 {foreign:+,.0f}억원, 기관 {institution:+,.0f}억원, 개인 {individual:+,.0f}억원으로 집계됐습니다. 이날 방향을 만든 주체는 {driver}이며 다음 거래일에도 같은 주체의 연속성이 유지되는지가 중요합니다.",
        f"전체 추정 거래대금은 {turnover / 1e12:,.1f}조원입니다. 거래대금 상위 3개 종목 집중도는 {top3_share:.1f}%로, 수치가 높을수록 지수 상승과 체감 수익률 사이의 괴리가 커질 가능성이 있습니다.",
        f"업종별로는 {best_sector['name']}({best_sector['change_pct']:+.2f}%)가 가장 강했고 {weak_sector['name']}({weak_sector['change_pct']:+.2f}%)가 상대적으로 부진했습니다. 주도 업종의 강세가 인접 업종으로 번지는지 확인해야 추세의 지속성을 평가할 수 있습니다.",
        f"거래대금 기준 시장의 중심 종목은 {leader_names}입니다. 단순 등락률보다 실제 자금이 집중된 종목을 우선 추적했으며, 이들의 거래대금 유지 여부가 단기 시장 심리의 선행 신호가 될 수 있습니다.",
        f"뉴스 레이더에는 거래대금 상위 종목과 연결된 기사 {len(headlines[:8])}건을 선별했습니다. 다음 거래일에는 외국인 수급, 상승 종목 비중, 주도 업종의 거래대금 확산과 야간 글로벌 변수의 방향을 함께 점검할 필요가 있습니다.",
    ]
    payload = {"version": REPORT_VERSION, "date": day, "market": market, "created_at": now.isoformat(timespec="seconds"),
               "index": index, "investor": investor, "breadth": {"advance": advance, "decline": decline, "flat": flat, "advance_ratio": round(breadth, 1)},
               "turnover_estimate": turnover, "top_up": top_up, "top_down": top_down, "active": active,
               "sectors": sector_rows[:10], "headlines": headlines[:8],
               "summary": f"{market}는 {pct:+.2f}% {tone} 마감했습니다. 상승 종목 비중은 {breadth:.1f}%였으며 수급의 핵심은 {driver}였습니다.",
               "analysis": analysis,
               "disclaimer": "본 리포트는 공개 시장 데이터를 자동 집계한 투자 참고 자료이며 투자 권유가 아닙니다. 가격과 수급은 제공처 사정에 따라 지연·정정될 수 있습니다."}
    market_brief_store.save(day, market, payload, now.isoformat())
    return payload


def run_all(force=False):
    with _lock:
        return {market: generate(market, force) for market in ("KOSPI", "KOSDAQ")}


def _loop():
    done = ""
    while True:
        now = dt.datetime.now(KST)
        key = now.date().isoformat()
        if now.weekday() < 5 and now.time() >= dt.time(16, 10) and done != key:
            try:
                run_all()
                done = key
            except Exception:
                log.exception("market brief batch failed")
        time.sleep(300)


def start_scheduler():
    threading.Thread(target=_loop, daemon=True, name="market-brief-batch").start()
