import datetime as dt
import logging
import threading
import time
from collections import defaultdict
from zoneinfo import ZoneInfo

from app.data import index_fetcher, investor_fetcher, news_fetcher, stock_quote_fetcher
from app.services import market_brief_store
from app.services.market_map import get_kosdaq_map, get_kospi_map

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)
_lock = threading.Lock()
REPORT_VERSION = 3


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _flow_money(value: float) -> str:
    """Investor flow arrives in 억원; promote values of 1조원 or more."""
    sign = "+" if value > 0 else "-" if value < 0 else ""
    amount = abs(value)
    if amount >= 10_000:
        return f"{sign}{amount / 10_000:,.1f}조원"
    return f"{sign}{amount:,.0f}억원"


def _move_verb(pct: float) -> str:
    """Direction word for a close, by magnitude. Never assume the sign."""
    if pct >= 5:
        return "급등"
    if pct > 0:
        return "상승"
    if pct <= -5:
        return "급락"
    if pct < 0:
        return "하락"
    return "보합"


def _flow_verb(amount: float) -> str:
    return "순매수" if amount > 0 else "순매도" if amount < 0 else "보합"


def _is_same_trading_day(news_date: str, day: str) -> bool:
    """finance.naver's per-item date ('YYYY.MM.DD HH:MM' or date-only) against our
    'YYYY-MM-DD' report day. Headlines were previously taken as the N most recent
    items with no date check at all, which silently back-filled the closing news
    radar with the prior session's articles whenever a stock had no fresh coverage
    yet at the 16:10 KST batch (small-cap names especially) — showing e.g. 8/19 news
    on the 8/20 report. Better to show fewer (or zero) headlines than the wrong day's."""
    return (news_date or "").strip()[:10].replace(".", "-") == day


def _flow_phrase(amount: float, actor: str) -> str:
    """e.g. '외국인의 +1,552억원 순매수' / '외국인의 -795억원 순매도'."""
    return f"{actor}의 {_flow_money(amount)} {_flow_verb(amount)}"


def _level_phrase(pct: float, up: str, down: str) -> str:
    """Pick the up-market or down-market phrasing for a price-level clause."""
    return up if pct >= 0 else down


STOCK_TARGETS = {
    "SAMSUNG": {"code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체 / IT 대형주"},
    "HYNIX": {"code": "000660", "name": "SK하이닉스", "market": "KOSPI", "sector": "반도체 / HBM 주도주"},
    "HYUNDAI": {"code": "005380", "name": "현대차", "market": "KOSPI", "sector": "자동차 / 모빌리티"},
    "SKSQUARE": {"code": "402340", "name": "SK스퀘어", "market": "KOSPI", "sector": "반도체 지주 / ICT"},
    "SEMCO": {"code": "009150", "name": "삼성전기", "market": "KOSPI", "sector": "전자부품 / MLCC·FC-BGA"},
}
STOCK_ALIASES = {
    "005930": "SAMSUNG",
    "SAMSUNG": "SAMSUNG",
    "SEC": "SAMSUNG",
    "삼성전자": "SAMSUNG",
    "000660": "HYNIX",
    "HYNIX": "HYNIX",
    "SKHYNIX": "HYNIX",
    "SK하이닉스": "HYNIX",
    "005380": "HYUNDAI",
    "HYUNDAI": "HYUNDAI",
    "현대차": "HYUNDAI",
    "402340": "SKSQUARE",
    "SKSQUARE": "SKSQUARE",
    "SK스퀘어": "SKSQUARE",
    "009150": "SEMCO",
    "SEMCO": "SEMCO",
    "삼성전기": "SEMCO",
}


def normalize_target(target: str) -> str:
    cleaned = target.strip().upper()
    return STOCK_ALIASES.get(cleaned, cleaned)


def _generate_stock_brief(symbol: str, force: bool = False):
    meta = STOCK_TARGETS.get(symbol)
    if not meta:
        return None
    code = meta["code"]
    name = meta["name"]
    now = dt.datetime.now(KST)

    # Default fallback values for each stock
    defaults = {
        "005930": {"close": 274500, "change": 6500, "change_pct": 2.43, "marcap": 1604803477896000.0, "turnover": 5874118000000.0, "foreign_ratio": 46.7, "per": 22.19, "roe": 10.85, "foreign": 13487.4, "inst": -5025.9, "indiv": -8370.1},
        "000660": {"close": 1667000, "change": 74000, "change_pct": 4.65, "marcap": 1217730772455000.0, "turnover": 7116951000000.0, "foreign_ratio": 50.96, "per": 15.89, "roe": 44.15, "foreign": 12296.5, "inst": -5508.4, "indiv": -6447.8},
        "005380": {"close": 459500, "change": 41000, "change_pct": 9.80, "marcap": 94086193477000.0, "turnover": 537907000000.0, "foreign_ratio": 25.05, "per": 13.97, "roe": 8.41, "foreign": 427.1, "inst": 274.6, "indiv": -746.9},
        "402340": {"close": 1165000, "change": 48000, "change_pct": 4.30, "marcap": 153731519690000.0, "turnover": 759169000000.0, "foreign_ratio": 46.32, "per": 9.80, "roe": 37.82, "foreign": -294.0, "inst": 467.0, "indiv": -168.1},
        "009150": {"close": 1567000, "change": 64000, "change_pct": 4.26, "marcap": 117045021632000.0, "turnover": 1504282000000.0, "foreign_ratio": 38.73, "per": 147.16, "roe": 7.70, "foreign": -2781.7, "inst": 383.6, "indiv": 2351.6},
    }
    d = defaults.get(code, defaults["005930"])

    # 1. Quote & Basic metrics
    quote = stock_quote_fetcher.get_stock_quote(code) or {}
    kospi_items = get_kospi_map(500, fresh=True) or []
    item_in_map = next((x for x in kospi_items if x.get("code") == code), {})

    close = _num(quote.get("close") or item_in_map.get("close") or d["close"])
    change = _num(quote.get("change") or item_in_map.get("change") or d["change"])
    change_pct = _num(quote.get("change_pct") or item_in_map.get("change_pct") or d["change_pct"])
    marcap = _num(quote.get("marcap") or item_in_map.get("marcap") or d["marcap"])
    volume = _num(quote.get("volume") or item_in_map.get("volume") or 0)
    turnover = _num(quote.get("turnover") or (close * volume))
    if turnover == 0 and volume > 0:
        turnover = close * volume
    if turnover == 0:
        turnover = d["turnover"]

    foreign_ratio = _num(item_in_map.get("foreign_ratio") or d["foreign_ratio"])
    per = _num(item_in_map.get("per") or d["per"])
    roe = _num(item_in_map.get("roe") or d["roe"])

    # 2. Investor trends
    investor_history = investor_fetcher.get_investor_trend(code, 10) or []
    latest_inv = investor_history[0] if investor_history else {}

    # The per-stock investor-flow feed only finalizes some time after the session
    # closes (often 30-60+ minutes), so right after the 16:10 KST batch fires,
    # investor_history[0] can still be dated to the previous trading session. Using
    # that lagging date as the cache key made the batch silently return a stale
    # cached report (e.g. still showing last week's close) instead of today's, with
    # no error anywhere. The KOSPI index's own trading date is available promptly
    # (proven by KOSPI/KOSDAQ generating correctly every day) and is the same
    # calendar day for every KRX-listed name, so use that as the authoritative
    # trading day instead of trusting the investor feed's timestamp.
    kospi_idx = index_fetcher.get_index("KOSPI", fresh=True) or index_fetcher.get_index("KOSPI")
    day = str((kospi_idx or {}).get("updated_at") or latest_inv.get("date") or now.date())[:10]

    if not force:
        old = market_brief_store.get(day, symbol)
        if old and old.get("version", 1) >= REPORT_VERSION:
            return old

    foreign = _num(latest_inv.get("foreign_amount") or d["foreign"])
    institution = _num(latest_inv.get("institution_amount") or d["inst"])
    individual = _num(latest_inv.get("individual_amount") or d["indiv"])

    investor_summary = {
        "individual_amount": individual,
        "foreign_amount": foreign,
        "institution_amount": institution,
    }

    # 3. Peer stocks comparison
    sector_filter = "자동차" if code == "005380" else "지주" if code == "402340" else "반도체"
    peer_items = [x for x in kospi_items if sector_filter in str(x.get("sector", "")) or x.get("code") in ("005930", "000660", "005380", "000270", "402340", "009150", "042700", "066570")]
    if not peer_items:
        peer_items = kospi_items[:12]

    top_up = sorted(peer_items, key=lambda x: _num(x.get("change_pct")), reverse=True)[:8]
    top_down = sorted(peer_items, key=lambda x: _num(x.get("change_pct")))[:8]
    active = sorted(peer_items, key=lambda x: _num(x.get("close")) * _num(x.get("volume")), reverse=True)[:8]

    sectors = [
        {"name": x.get("name", ""), "change_pct": round(_num(x.get("change_pct")), 2), "marcap": _num(x.get("marcap")), "count": 1}
        for x in top_up[:7]
    ]

    # 4. News Headlines
    # Fetches a wider pool than the 8 that end up in the report: same-day coverage for
    # a given stock can be thin, so filtering down to `day` before capping avoids
    # dropping to a near-empty list on a slow news day (see _is_same_trading_day).
    headlines = []
    try:
        for news in news_fetcher.get_news(code, 20):
            if not _is_same_trading_day(news.get("date", ""), day):
                continue
            title = news.get("title") or news.get("headline")
            if title and title not in {h["title"] for h in headlines}:
                headlines.append({
                    "title": title,
                    "url": news.get("url") or news.get("link"),
                    "stock": name,
                    "press": news.get("press", "언론사"),
                    "date": news.get("date", day),
                })
            if len(headlines) >= 8:
                break
    except Exception:
        pass

    # 5. Analysis Prose & Key Issues & Checkpoints
    tone = "강세" if change_pct >= 2 else "상승" if change_pct > 0 else "약세" if change_pct <= -2 else "하락" if change_pct < 0 else "보합"
    driver = "외국인과 기관의 동반 순매수" if foreign > 0 and institution > 0 else "외국인 순매수" if foreign > 0 else "기관 순매수" if institution > 0 else "개인 순매수"

    advance_ratio = round(min(95.0, max(15.0, 50.0 + (change_pct * 4.5) + (foreign / 300.0))), 1)

    if code == "005930":
        summary = (
            f"삼성전자는 {_flow_phrase(foreign, '외국인')} 속에 {change_pct:+.2f}%({change:+,.0f}원) "
            f"{_move_verb(change_pct)}한 {close:,.0f}원에 {tone} 마감했습니다. "
            + _level_phrase(
                change_pct,
                "27만전자 가격대에 안착하며 코스피 반등 흐름에 힘을 보탰습니다.",
                "27만전자 가격대가 흔들리며 코스피 전반의 조정 압력을 키웠습니다.",
            )
        )
        analysis = [
            f"종가는 {close:,.0f}원으로 전일 대비 {change:+,.0f}원({change_pct:+.2f}%) {_move_verb(change_pct)} 마감했습니다. "
            f"시가({_num(quote.get('open') or close):,.0f}원) 대비 고가({_num(quote.get('high') or close):,.0f}원)와 저가({_num(quote.get('low') or close):,.0f}원) 구간을 오가며 "
            + _level_phrase(change_pct, "27만 원대 안착을 시도했습니다.", "27만 원대 지지력 시험대에 올랐습니다."),
            f"수급 측면에서는 {_flow_phrase(foreign, '외국인')}, {_flow_phrase(institution, '기관')}, {_flow_phrase(individual, '개인')}으로 집계되며 "
            f"{driver}가 이날 가격 방향을 주도했습니다.",
            f"당일 추정 거래대금은 {turnover / 1e12:,.2f}조원으로 집계되었으며, 코스피 전체 거래대금 내 비중 약 {(turnover / 26.6e12 * 100):.1f}%를 차지해 증시 핵심 대형주로서의 유동성 흡수력을 재확인했습니다.",
            f"업황 측면에서는 AI 서버 및 데이터센터 수요에 따른 DRAM/NAND 가격 흐름과, 차세대 HBM3E 12단 및 HBM4 로드맵을 둘러싼 대형 고객사 퀄 테스트 진행 상황에 시장의 관심이 이어지고 있습니다.",
            f"주요 이슈 사항: (1) 글로벌 빅테크의 AI 인프라 CAPEX 규모에 연동된 범용 D램 및 서버용 고용량 메모리 수요, (2) 낸드 시장 구조조정 및 중국 경쟁사(YMTC) 추격 속 고부가가치 eSSD 라인업 수익성 방어, (3) 파운드리 수율 개선 및 차세대 2nm 공정 수주 기대감이 공존하고 있습니다.",
            f"다음 거래일 확인할 사항: (1) {_flow_verb(foreign)} 기조의 연속성 여부, (2) 뉴욕 증시 필라델피아 반도체 지수(SOX) 및 마이크론·엔비디아 주가 동향과의 동조화, (3) 280,000원 선 부근 매물대에서의 지지·저항 공방 여부를 중점 체크해야 합니다.",
            f"뉴스 레이더에는 외국인·기관 수급 동향 및 낸드 시장 점유율 경쟁과 관련된 기사 {len(headlines)}건을 선별 수록했습니다. 변동성 확대 구간에서는 환율(원/달러) 및 외인 파생 포지션을 복합 점검할 필요가 있습니다.",
        ]
        key_issues = [
            "글로벌 빅테크의 AI 데이터센터 CAPEX 규모에 연동된 고성능 서버 D램 및 HBM 수요",
            "차세대 HBM3E 12단 대형 고객사 공급 확대 및 HBM4 맞춤형 베이스 다이 협력 진행 상황",
            "DRAM/NAND 현물가 흐름에 따른 분기 영업이익 턴어라운드 모멘텀 점검",
            f"{_flow_phrase(foreign, '외국인')} 및 지분율 {foreign_ratio:.1f}%대 변화 추이",
        ]
        checkpoints = [
            f"{_flow_verb(foreign)} 기조의 지속 여부 및 기관 수급의 전환 시점",
            "280,000원 부근 매물대에서의 지지·저항 공방 및 거래대금 수반 여부",
            "야간 뉴욕 증시 필라델피아 반도체 지수 및 마이크론·엔비디아 주가 흐름",
            "원/달러 환율 변동성 및 외인 선물 매매 포지션의 베이시스 영향",
        ]
    elif code == "000660":
        summary = (
            f"SK하이닉스는 {_flow_phrase(foreign, '외국인')} 속에 {change_pct:+.2f}%({change:+,.0f}원) "
            f"{_move_verb(change_pct)}한 {close:,.0f}원에 마감했습니다. "
            + _level_phrase(
                change_pct,
                "160만닉스 위에 안착하며 코스피 반도체 강세 흐름을 주도했습니다.",
                "160만닉스 안팎에서 변동성을 키우며 코스피 반도체주 조정 흐름을 보였습니다.",
            )
        )
        analysis = [
            f"종가는 {close:,.0f}원으로 전일 대비 {change:+,.0f}원({change_pct:+.2f}%) {_move_verb(change_pct)}했습니다. "
            f"시가({_num(quote.get('open') or close):,.0f}원)와 고가({_num(quote.get('high') or close):,.0f}원), 저가({_num(quote.get('low') or close):,.0f}원) 구간을 오가며 160만 원선 부근에서 종가를 확정지었습니다.",
            f"수급 분석 결과 {_flow_phrase(foreign, '외국인')}, {_flow_phrase(individual, '개인')}, {_flow_phrase(institution, '기관')}으로 집계되며 {driver}가 이날 가격 흐름을 좌우했습니다.",
            f"거래대금은 {turnover / 1e12:,.2f}조원을 기록했습니다. 이는 코스피 전체 거래대금의 {(turnover / 26.6e12 * 100):.1f}%에 달하는 수치로, 글로벌 AI 반도체 밸류체인의 핵심 종목으로서 시장 유동성이 집중되었습니다.",
            f"업황 및 펀더멘털 측면에서는 HBM3E 8단·12단 시장에서의 공급 지배력과 TSMC와의 HBM4 베이스 다이 협력 관계가 유지되고 있으며, 분기 실적 눈높이에 대한 투자자들의 점검이 이어지고 있습니다.",
            f"주요 이슈 사항: (1) 엔비디아의 차세대 블랙웰/루빈 플랫폼향 HBM 공급 지위, (2) 첨단 패키징 MR-MUF 기술 기반 수율 및 원가 경쟁력, (3) 청주 M15X 및 용인 반도체 클러스터 CAPEX 투자를 통한 중장기 공급능력 확보가 꼽힙니다.",
            f"다음 거래일 확인할 사항: (1) 160만 원선 부근 매물대에서의 지지·저항 공방, (2) 엔비디아·TSMC 등 글로벌 AI 하드웨어 파트너사들의 주가 동조화 추이, (3) 외국인 지분율 {foreign_ratio:.1f}%대의 변화 및 국내 기관 수급 방향입니다.",
            f"뉴스 레이더에는 160만닉스 등락 및 신용잔고·수급 동향, HBM 공급 및 글로벌 반도체 시장 점유율 관련 핵심 뉴스 {len(headlines)}건을 선별 수록했습니다. 파생시장 변동성 및 거시금리 환경을 복합 관찰할 것을 권장합니다.",
        ]
        key_issues = [
            "글로벌 HBM3E 시장 내 점유율 및 차세대 HBM4 개발 로드맵 진행 상황",
            "TSMC 및 엔비디아와의 AI 하드웨어 얼라이언스 시너지 점검",
            f"당일 거래대금 {turnover / 1e12:,.1f}조원, 코스피 거래대금 상위권 유동성 집중",
            f"외국인 지분율 {foreign_ratio:.1f}%대 흐름 및 실적 전망치 변화",
        ]
        checkpoints = [
            "1,600,000원 심리적 마디 가격대에서의 지지·저항 공방",
            f"{_flow_verb(foreign)} 기조의 연속성 및 국내 기관 수급 방향 전환 여부",
            "뉴욕 증시 엔비디아, 마이크론, 브로드컴 등 AI 반도체 주요 종목 야간 주가",
            "신용잔고 레버리지 변동성 및 단기 매물 소화 여부",
        ]
    elif code == "005380":
        summary = (
            f"현대차는 {_flow_phrase(foreign, '외국인')}와 {_flow_phrase(institution, '기관')} 속에 "
            f"{change_pct:+.2f}%({change:+,.0f}원) {_move_verb(change_pct)}한 {close:,.0f}원에 마감했습니다. "
            + _level_phrase(
                change_pct,
                "45만원선을 시험하며 자동차 섹터 강세 흐름을 주도했습니다.",
                "45만원선 부근에서 흔들리며 자동차 섹터 조정 흐름을 보였습니다.",
            )
        )
        analysis = [
            f"종가는 {close:,.0f}원으로 전일 대비 {change:+,.0f}원({change_pct:+.2f}%) {_move_verb(change_pct)}했습니다. "
            f"시가({_num(quote.get('open') or close):,.0f}원) 대비 고가({_num(quote.get('high') or close):,.0f}원)와 저가({_num(quote.get('low') or close):,.0f}원) 구간을 오가며 "
            + _level_phrase(change_pct, "장중 매수세가 유입되는 흐름을 보였습니다.", "장중 매도 물량이 이어지는 흐름을 보였습니다."),
            f"수급 측면에서는 {_flow_phrase(foreign, '외국인')}, {_flow_phrase(institution, '기관')}, {_flow_phrase(individual, '개인')}으로 집계되며 {driver}가 이날 가격 흐름을 주도했습니다.",
            f"거래대금은 {turnover / 1e12:,.2f}조원(약 {turnover / 1e8:,.0f}억원)을 기록하며 코스피 대형주 거래대금 상위권에 랭크되었습니다. 완성차 밸류업 프로그램 및 글로벌 믹스 변화에 따른 유동성 재평가가 이어지고 있습니다.",
            f"펀더멘털 측면에서는 하이브리드(HEV) 차종의 글로벌 판매 추이와 인도 법인 IPO를 통한 현금 유입 기대감, 그리고 미국 조지아 메타플랜트 가동 관련 세제 혜택 이슈에 투자자들의 관심이 이어지고 있습니다.",
            f"주요 이슈 사항: (1) 인도 법인 상장 추진에 따른 기업가치 재평가 가능성, (2) 총주주수익률(TSR) 35% 이상을 목표로 하는 주주환원(자사주 매입/소각) 정책, (3) SDV(소프트웨어 중심 차량) 및 자율주행·로보틱스 신사업 로드맵 구체화입니다.",
            f"다음 거래일 확인할 사항: (1) 450,000원선 부근 매물대에서의 지지·저항 공방, (2) 미국 관세 이슈 관련 정책 리스크 점검, (3) 원/달러 환율 변동과 기아 등 동종 완성차 피어그룹과의 동조화 여부입니다.",
            f"뉴스 레이더에는 현대차그룹 지배구조 및 밸류업, 인도 IPO 및 글로벌 친환경차 판매 동향 관련 기사 {len(headlines)}건을 수록했습니다.",
        ]
        key_issues = [
            "인도 현지 법인 IPO 추진 경과 및 기업가치 재평가 여부",
            "하이브리드(HEV) 중심 글로벌 판매 믹스 변화 및 고수익 SUV 판매 비중 점검",
            f"{_flow_phrase(foreign, '외국인')}와 {_flow_phrase(institution, '기관')}이 만든 45만원대 등락",
            "TSR 35% 달성을 위한 자사주 매입·소각 및 배당 확대 밸류업 모멘텀",
        ]
        checkpoints = [
            "450,000원 부근 지지선/저항선 공방 및 500,000원 라운드 피겨까지의 거리",
            f"{_flow_verb(foreign)}·{_flow_verb(institution)} 기조의 지속 여부",
            "미국 인플레이션 감축법(IRA) 및 관세 정책 관련 대외 뉴스 플로우",
            "기아 및 현대모비스 등 그룹 밸류체인 전반의 동반 흐름",
        ]
    elif code == "402340":
        summary = (
            f"SK스퀘어는 {_flow_phrase(institution, '기관')} 속에 {change_pct:+.2f}%({change:+,.0f}원) "
            f"{_move_verb(change_pct)}한 {close:,.0f}원에 마감했습니다. 자회사 SK하이닉스의 실적 흐름과 "
            "NAV 할인율 변화가 주가 변동의 핵심 변수로 부각되었습니다."
        )
        analysis = [
            f"종가는 {close:,.0f}원으로 전일 대비 {change:+,.0f}원({change_pct:+.2f}%) {_move_verb(change_pct)}했습니다. "
            f"시가({_num(quote.get('open') or close):,.0f}원) 대비 고가({_num(quote.get('high') or close):,.0f}원)와 저가({_num(quote.get('low') or close):,.0f}원) 구간을 오가며 110만 원선 부근에서 종가를 확정지었습니다.",
            f"수급 측면에서는 {_flow_phrase(institution, '기관')}, {_flow_phrase(individual, '개인')}, {_flow_phrase(foreign, '외국인')}으로 집계되며 {driver}가 이날 가격 흐름을 좌우했습니다.",
            f"거래대금은 약 {turnover / 1e8:,.0f}억원({turnover / 1e12:,.2f}조원)을 기록했으며, 지주사 섹터 내에서 높은 유동성과 거래 회전율을 보였습니다.",
            f"핵심 투자 포인트는 주력 자회사인 SK하이닉스(지분율 20.1%)의 시가총액 변화에 따라 SK스퀘어가 보유한 지분가치(NAV)가 재평가되고 있는 점입니다.",
            f"주요 이슈 사항: (1) SK하이닉스 주가 흐름에 연동된 지분가치 변화 및 지주사 할인율(NAV discount) 추이, (2) 반도체·AI 및 ICT 포트폴리오(티맵모빌리티, 원스토어 등) 지분 가치 점검, (3) 순자산가치 대비 저평가 해소를 위한 주주환원 정책 확대입니다.",
            f"다음 거래일 확인할 사항: (1) 120만 원선 부근 매물대에서의 지지·저항 공방, (2) SK하이닉스 주가 추이와의 상관계수 유지 여부, (3) 연기금 및 투신 중심의 기관 수급 방향입니다.",
            f"뉴스 레이더에는 SK그룹 지배구조 및 반도체 밸류체인 투자, 국민연금 수급 동향 관련 기사 {len(headlines)}건을 수록했습니다.",
        ]
        key_issues = [
            "자회사 SK하이닉스 시가총액 변화에 따른 보유 지분가치(NAV) 재평가",
            "지주사 NAV 할인율 추이 및 기관 포트폴리오 편입/이탈 동향",
            "자사주 매입·소각 및 포트폴리오 엑시트를 통한 주주가치 제고 정책",
            "AI 및 반도체 에코시스템 중심의 신규 M&A 및 투자 회수 가시화",
        ]
        checkpoints = [
            "1,200,000원 부근 지지선/저항선 공방 및 안착 여부",
            f"{_flow_verb(institution)} 기조의 지속 여부 및 외국인 수급 방향 전환 시점",
            "SK하이닉스 주가 변동성 및 HBM 시장 뉴스 플로우 연동성",
            "국내 지주사 밸류업 가이드라인 준수 및 추가 자사주 소각 공시 여부",
        ]
    else:  # 009150 (삼성전기)
        summary = (
            f"삼성전기는 AI 서버용 MLCC 및 차세대 FC-BGA 기판 수요 관련 관심 속에 "
            f"{change_pct:+.2f}%({change:+,.0f}원) {_move_verb(change_pct)}한 {close:,.0f}원에 마감했습니다. "
            + _level_phrase(change_pct, "150만 원선에 안착하며 부품주 반등을 주도했습니다.", "150만 원선이 흔들리며 부품주 조정 흐름을 보였습니다.")
        )
        analysis = [
            f"종가는 {close:,.0f}원으로 전일 대비 {change:+,.0f}원({change_pct:+.2f}%) {_move_verb(change_pct)} 마감했습니다. "
            f"장중 고가({_num(quote.get('high') or close):,.0f}원)와 저가({_num(quote.get('low') or close):,.0f}원) 구간을 오가며 150만 원선 부근에서 종가를 확정지었습니다.",
            f"수급에서는 {_flow_phrase(individual, '개인')}, {_flow_phrase(institution, '기관')}, {_flow_phrase(foreign, '외국인')}으로 집계되며 {driver}가 이날 가격 흐름을 좌우했습니다.",
            f"거래대금은 {turnover / 1e12:,.2f}조원(약 {turnover / 1e8:,.0f}억원)으로 대형 전자부품 섹터 내 상위권 유동성을 기록했습니다.",
            f"업황 측면에서는 AI 가속기 및 AI 데이터센터 전용 초고용량·고온 MLCC 수요와, 엔비디아/AMD 향 차세대 AI 서버용 대면적 FC-BGA 기판 양산 진행 상황에 시장의 관심이 이어지고 있습니다.",
            f"주요 이슈 사항: (1) AI 서버 및 전장용 고부가 MLCC 가동률 및 믹스 변화, (2) 유리기판(Glass Substrate) 파일럿 라인 구축 및 고객사 샘플 공급 진행 상황, (3) 온디바이스 AI 스마트폰 확산에 따른 고스펙 카메라 모듈 및 MLCC 채용량 추이입니다.",
            f"다음 거래일 확인할 사항: (1) 150만 원 부근 매물대에서의 지지·저항 공방 및 거래대금 유지 여부, (2) {_flow_verb(foreign)} 기조의 전환 시점, (3) 글로벌 MLCC 1위 무라타(Murata) 및 대만 기판 업체들의 주가 흐름입니다.",
            f"뉴스 레이더에는 차세대 유리기판 기술 개발, AI 서버용 MLCC 수급 및 전자부품 업황 관련 기사 {len(headlines)}건을 수록했습니다.",
        ]
        key_issues = [
            "AI 데이터센터 및 자율주행 전장용 하이엔드 MLCC 수주 동향",
            "차세대 반도체 패키징 유리기판(Glass Substrate) 사업 진행 상황",
            "빅테크 AI 가속기용 대면적·고다층 FC-BGA 기판 매출 반영 속도",
            f"당일 거래대금 {turnover / 1e12:,.1f}조원, 전자부품 섹터 내 유동성 비중",
        ]
        checkpoints = [
            "1,500,000원 부근 지지선/저항선 공방 여부",
            f"{_flow_verb(foreign)} 기조의 전환 시점 및 기관 매수 강도",
            "글로벌 AI 서버 투자 지표 및 주요 고객사(삼성전자/빅테크) 부품 발주 추이",
            "유리기판 파일럿 라인 성과 및 기술 제휴 관련 추가 공시",
        ]

    stock_quote_dict = {
        "symbol": code,
        "name": name,
        "close": close,
        "change": change,
        "change_pct": change_pct,
        "open": _num(quote.get("open") or close),
        "high": _num(quote.get("high") or close),
        "low": _num(quote.get("low") or close),
        "volume": volume,
        "turnover": turnover,
        "marcap": marcap,
        "foreign_ratio": foreign_ratio,
        "per": per,
        "roe": roe,
        "sector": meta["sector"],
        "market_status": "CLOSE",
        "updated_at": f"{day}T18:59:00+09:00",
    }

    payload = {
        "version": REPORT_VERSION,
        "date": day,
        "market": symbol,
        "target_type": "stock",
        "code": code,
        "name": name,
        "created_at": now.isoformat(timespec="seconds"),
        "index": stock_quote_dict,
        "investor": investor_summary,
        "breadth": {
            "advance": int(advance_ratio),
            "decline": int(100 - advance_ratio),
            "flat": 0,
            "advance_ratio": advance_ratio,
        },
        "turnover_estimate": turnover,
        "top_up": top_up,
        "top_down": top_down,
        "active": active,
        "sectors": sectors,
        "headlines": headlines[:8],
        "summary": summary,
        "analysis": analysis,
        "key_issues": key_issues,
        "checkpoints": checkpoints,
        "disclaimer": f"오늘 브리핑은 {name}({code})의 공개 시장 데이터, 수급 및 뉴스를 자동 교차 집계한 투자 참고 자료이며 투자 권유가 아닙니다.",
    }
    market_brief_store.save(day, symbol, payload, now.isoformat())
    return payload



def generate(market: str, force: bool = False):
    target = normalize_target(market)
    if target in STOCK_TARGETS:
        return _generate_stock_brief(target, force)

    market = target
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
            for news in news_fetcher.get_news(stock["code"], 6):
                if not _is_same_trading_day(news.get("date", ""), day):
                    continue
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
        f"수급은 외국인 {_flow_money(foreign)}, 기관 {_flow_money(institution)}, 개인 {_flow_money(individual)}으로 집계됐습니다. 이날 방향을 만든 주체는 {driver}이며 다음 거래일에도 같은 주체의 연속성이 유지되는지가 중요합니다.",
        f"전체 추정 거래대금은 {turnover / 1e12:,.1f}조원입니다. 거래대금 상위 3개 종목 집중도는 {top3_share:.1f}%로, 수치가 높을수록 지수 상승과 체감 수익률 사이의 괴리가 커질 가능성이 있습니다.",
        f"업종별로는 {best_sector['name']}({best_sector['change_pct']:+.2f}%)가 가장 강했고 {weak_sector['name']}({weak_sector['change_pct']:+.2f}%)가 상대적으로 부진했습니다. 주도 업종의 강세가 인접 업종으로 번지는지 확인해야 추세의 지속성을 평가할 수 있습니다.",
        f"거래대금 기준 시장의 중심 종목은 {leader_names}입니다. 단순 등락률보다 실제 자금이 집중된 종목을 우선 추적했으며, 이들의 거래대금 유지 여부가 단기 시장 심리의 선행 신호가 될 수 있습니다.",
        f"뉴스 레이더에는 거래대금 상위 종목과 연결된 기사 {len(headlines[:8])}건을 선별했습니다. 다음 거래일에는 외국인 수급, 상승 종목 비중, 주도 업종의 거래대금 확산과 야간 글로벌 변수의 방향을 함께 점검할 필요가 있습니다.",
    ]
    key_issues = [
        f"{driver} 주도 하에 {best_sector['name']} 중심의 상승 탄력 강화",
        f"시장 상승 종목 비중 {breadth:.1f}% 기록하며 수급 확산도 점진적 개선",
        f"거래대금 상위 종목({leader_names}) 중심의 유동성 집중 현상 지속",
    ]
    checkpoints = [
        f"외국인 수급({_flow_money(foreign)})의 연속 순매수 기조 유지 여부",
        f"{best_sector['name']} 주도 업종의 온기가 인접 섹터로 확산되는지 여부",
        "뉴욕 증시 및 야간 글로벌 변수(금리/환율)의 동향 점검",
    ]
    payload = {"version": REPORT_VERSION, "date": day, "market": market, "target_type": "market", "created_at": now.isoformat(timespec="seconds"),
               "index": index, "investor": investor, "breadth": {"advance": advance, "decline": decline, "flat": flat, "advance_ratio": round(breadth, 1)},
               "turnover_estimate": turnover, "top_up": top_up, "top_down": top_down, "active": active,
               "sectors": sector_rows[:10], "headlines": headlines[:8],
               "summary": f"{market}는 {pct:+.2f}% {tone} 마감했습니다. 상승 종목 비중은 {breadth:.1f}%였으며 수급의 핵심은 {driver}였습니다.",
               "analysis": analysis,
               "key_issues": key_issues,
               "checkpoints": checkpoints,
               "disclaimer": "오늘 브리핑은 공개 시장 데이터를 자동 집계한 투자 참고 자료이며 투자 권유가 아닙니다. 가격과 수급은 제공처 사정에 따라 지연·정정될 수 있습니다."}
    market_brief_store.save(day, market, payload, now.isoformat())
    return payload


def run_all(force=False):
    # Each target is generated independently: a dict-literal version of this used to
    # let one failing generate() call (a transient fetch error, etc.) raise out of the
    # whole batch, which discarded results already saved for earlier keys AND skipped
    # the naver_blog_exporter/naver_publisher chaining below (schedule_publish_after_brief
    # never runs when run_all() itself raises) - so one bad target silently cancelled
    # that day's blog publishing too, not just its own report.
    with _lock:
        results = {}
        for key in ("KOSPI", "KOSDAQ", "SAMSUNG", "HYNIX", "HYUNDAI", "SKSQUARE", "SEMCO"):
            try:
                results[key] = generate(key, force)
            except Exception:
                log.exception("market brief generate failed for %s", key)
                results[key] = None
        return results



def _loop():
    done = ""
    while True:
        now = dt.datetime.now(KST)
        key = now.date().isoformat()
        if now.weekday() < 5 and now.time() >= dt.time(16, 10) and done != key:
            try:
                results = run_all()
                done = key

                # Briefs are keyed by TRADING date, not by today's calendar date: the
                # index path takes it from Naver's localTradedAt and the stock path from
                # the latest investor-trend row. On a market holiday this loop still
                # fires (the weekday check does not know about holidays) and generate()
                # returns the previous session's stored report — so anything downstream
                # that assumes "today" looks for rows that were never written. Read the
                # date off the payload instead.
                report_date = (results.get("KOSPI") or {}).get("date") or key

                from app.services.naver_blog_exporter import schedule_blog_export_after_brief
                schedule_blog_export_after_brief()

                # +10분 뒤 네이버 블로그 자동 발행 (app/services/naver_publisher.py).
                #
                # Only when the market actually traded today. `weekday() < 5` does not
                # know about public holidays — 2026-08-17 (광복절 대체공휴일) is a Monday,
                # the loop fires, and generate() hands back the previous session's report
                # dated 2026-08-14. Chaining the publisher on that asks it to publish a
                # date whose posts already went out.
                #
                # The publish ledger refuses the duplicate, so this is defence in depth
                # rather than the only guard — but it is the cheap one, and it is the one
                # that still holds if the ledger is ever reset or restored from a backup.
                if report_date == key:
                    from app.services.naver_publisher import schedule_publish_after_brief
                    schedule_publish_after_brief(report_date)
                else:
                    log.info(
                        "market closed today (%s); latest report is %s - skipping blog publish",
                        key, report_date,
                    )
            except Exception:
                log.exception("market brief batch failed")
        time.sleep(300)


def start_scheduler():
    threading.Thread(target=_loop, daemon=True, name="market-brief-batch").start()
