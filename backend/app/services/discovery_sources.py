"""Public research adapters. No member data, DB credentials, or database writes.

Only the explicit snapshot action appends public observations to a separate JSONL
archive. Existing lines are never changed, compacted, or removed.
"""
from __future__ import annotations

import ast
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import re
import threading
import uuid
import xml.etree.ElementTree as ET
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

UTC = dt.timezone.utc
HEADERS = {"User-Agent": "Mozilla/5.0 KStockHub-PublicResearch/1.0", "Accept": "application/json,text/plain,*/*"}
ARCHIVE = Path(os.environ.get("DISCOVERY_SNAPSHOT_PATH") or Path(__file__).resolve().parents[1] / "data" / "discovery-public-snapshots.jsonl")
_archive_lock = threading.Lock()
_last_snapshot: dict[str, float] = {}


def now() -> str:
    return dt.datetime.now(UTC).isoformat(timespec="seconds")


def number(value):
    if isinstance(value, dict):
        value = value.get("raw", value.get("value"))
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(str(value).replace(",", "").replace("%", "").strip())
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def read(url: str, params=None, json_response=True, timeout=12):
    response = requests.get(url, params=params, headers=HEADERS, timeout=(5, timeout))
    response.raise_for_status()
    if len(response.content) > 12_000_000:
        raise ValueError("response too large")
    return response.json() if json_response else response.text


def package(source, items=None, **extra):
    return {"source": source, "received_at": now(), "items": items or [], **extra}


def symbol(code, market):
    code = code.upper()
    aliases = {"USDKRW": "KRW=X", "KOSPI": "^KS11", "KOSDAQ": "^KQ11", "SP500": "^GSPC", "GOLD": "GC=F", "OIL": "CL=F"}
    if code in aliases:
        return aliases[code]
    if not re.fullmatch(r"[A-Z0-9.\-]{1,16}", code):
        raise ValueError("invalid symbol")
    return f"{code}.{'KQ' if market == 'kosdaq' else 'KS'}" if re.fullmatch(r"\d[0-9A-Z]{5}", code) else code


def yahoo_chart(ticker: str, period="1y"):
    return read(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(ticker, safe='')}",
                {"range": period, "interval": "1d", "events": "div,splits", "includeAdjustedClose": "true"})["chart"]["result"][0]


def parse_chart(result):
    quotes = (result.get("indicators", {}).get("quote") or [{}])[0]
    adjusted = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose", [])
    timezone = ZoneInfo(result.get("meta", {}).get("exchangeTimezoneName") or "UTC")
    items = []
    for i, timestamp in enumerate(result.get("timestamp", [])):
        row = {"date": dt.datetime.fromtimestamp(timestamp, timezone).date().isoformat()}
        for key in ("open", "high", "low", "close", "volume"):
            values = quotes.get(key, [])
            row[key] = number(values[i]) if i < len(values) else None
        row["adjusted_close"] = number(adjusted[i]) if i < len(adjusted) else None
        # Exclude a still-forming session from full-day volume comparisons.
        row["complete"] = row["date"] < dt.datetime.now(timezone).date().isoformat()
        if row["close"] is not None and row["close"] > 0:
            items.append(row)
    return items


def asset(code="005930", market="kospi", period="1y"):
    def fetch():
        ticker = symbol(code, market)
        result = yahoo_chart(ticker, period)
        meta = result.get("meta", {})
        items = parse_chart(result)
        quote_time = meta.get("regularMarketTime")
        dividends = []
        timezone = ZoneInfo(meta.get("exchangeTimezoneName") or "UTC")
        for event in result.get("events", {}).get("dividends", {}).values():
            dividends.append({"ex_date": dt.datetime.fromtimestamp(event["date"], timezone).date().isoformat(), "amount": number(event.get("amount")), "currency": meta.get("currency"), "payment_date": None, "kind": "과거 배당락 기록"})
        return package("Yahoo Finance 일별 가격", items, code=code, market=market, currency=meta.get("currency"),
                       quote_at=dt.datetime.fromtimestamp(quote_time, UTC).isoformat() if quote_time else None,
                       price=number(meta.get("regularMarketPrice")), dividends=sorted(dividends, key=lambda x: x["ex_date"], reverse=True),
                       coverage="수신된 거래일만 비교합니다. 조정종가 미제공 시 가격수익률로 구분합니다.",
                       source_url=f"https://finance.yahoo.com/quote/{quote(ticker)}/history/")
    return cache.get_or_set(f"discovery:asset:{code}:{market}:{period}", 300, fetch)


def finance(code="005930", period="annual"):
    def fetch():
        if not re.fullmatch(r"\d[0-9A-Z]{5}", code):
            return us_finance(code)
        result = read(f"https://m.stock.naver.com/api/stock/{code}/finance/{period}")
        data = result.get("financeInfo", {})
        items = []
        for column in data.get("trTitleList", []):
            key = column["key"]
            values = {r["title"]: number(r.get("columns", {}).get(key, {}).get("value")) for r in data.get("rowList", [])}
            items.append({"period": column["title"], "date": key, "estimated": column.get("isConsensus") == "Y", "values": values})
        return package("Naver 기업 재무", items, code=code, currency="KRW", unit="금액: 억원 / EPS·BPS·배당: 원 / 비율: % / PER·PBR: 배",
                       coverage="실제치와 예상치를 분리합니다. 연결·별도 기준은 원문을 확인하세요.", source_url=f"https://m.stock.naver.com/domestic/stock/{code}/finance")
    return cache.get_or_set(f"discovery:finance:{code}:{period}", 3600, fetch)


def profile(code="005930"):
    def fetch():
        if re.fullmatch(r"\d[0-9A-Z]{5}", code):
            from app.data.company_overview_fetcher import get_company_info
            raw = get_company_info(code)
            return package("기업 공개 개요", [{"text": line} for line in raw.get("overview", [])], source_url=f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}", coverage="개요의 키워드 일치만 보여줍니다. 해당 테마 매출·수주의 확정 근거는 별도 공시를 확인하세요.")
        raw = yahoo_summary(code, "assetProfile").get("assetProfile", {})
        return package("기업 공개 개요", [{"text": raw.get("longBusinessSummary", "")}], source_url=f"https://finance.yahoo.com/quote/{code}/profile/", coverage="사업 개요 키워드와 확정된 매출 연결은 다릅니다.")
    return cache.get_or_set(f"discovery:profile:{code}", 3600, fetch)


def yahoo_summary(code, modules):
    # Uses the repository's existing in-memory vendor session, never a user login.
    from app.data.yahoo_session import get_crumb
    session, crumb = get_crumb()
    response = session.get(f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{quote(code, safe='')}",
                           params={"modules": modules, "crumb": crumb}, timeout=(5, 12))
    response.raise_for_status()
    return response.json()["quoteSummary"]["result"][0]


def us_finance(code):
    result = yahoo_summary(code, "incomeStatementHistory,earningsHistory,calendarEvents")
    items = []
    for row in result.get("incomeStatementHistory", {}).get("incomeStatementHistory", []):
        end = number(row.get("endDate"))
        items.append({"date": dt.datetime.fromtimestamp(end, UTC).date().isoformat() if end else "", "period": row.get("endDate", {}).get("fmt", ""), "estimated": False,
                      "values": {"매출액": number(row.get("totalRevenue")), "영업이익": number(row.get("operatingIncome")), "당기순이익": number(row.get("netIncome"))}})
    earnings = [{"date": r.get("quarter", {}).get("fmt"), "actual": number(r.get("epsActual")), "estimate": number(r.get("epsEstimate")), "difference": number(r.get("epsDifference"))} for r in result.get("earningsHistory", {}).get("history", [])]
    return package("Yahoo Finance 재무", items, code=code, currency="USD", unit="금액: USD / EPS: USD", earnings=earnings,
                   source_url=f"https://finance.yahoo.com/quote/{code}/financials/", coverage="수신된 연간 재무 기준. 공시 수정·결산월을 원문과 확인하세요.")


def fund(code="069500", region="KR"):
    def fetch():
        if region == "KR":
            raw = read(f"https://m.stock.naver.com/api/stock/{code}/integration")
            info = raw.get("etfKeyIndicator", {})
            holdings = []
            try:
                analysis = read(f"https://m.stock.naver.com/api/stock/{code}/etfAnalysis")
                holdings = [{"code": r["itemCode"], "name": r.get("itemName", r["itemCode"]), "weight": number(r.get("etfWeight"))} for r in analysis.get("etfTop10MajorConstituentAssets", []) if number(r.get("etfWeight")) is not None]
            except (requests.RequestException, ValueError):
                pass
            return package("Naver ETF 공개 정보", holdings, code=code, name=raw.get("stockName", code), region=region, currency="KRW",
                           holdings_date=None, expense_pct=number(info.get("totalFee")), nav=number(info.get("nav")),
                           yield_pct=number(info.get("dividendYieldTtm")), returns_1y=number(info.get("returnRate1y")),
                           coverage="공개 상위 10개 보유종목 부분집합. 구성종목 기준일 미제공이며 같은 날짜의 전체 운용사 자료로 정밀 비교할 수 있습니다.",
                           source_url=f"https://m.stock.naver.com/domestic/stock/{code}/total")
        result = yahoo_summary(code, "topHoldings,fundProfile,summaryDetail")
        profile = result.get("fundProfile", {}).get("feesExpensesInvestment", {})
        detail = result.get("summaryDetail", {})
        holdings = [{"code": r.get("symbol", ""), "name": r.get("holdingName", ""), "weight": number(r.get("holdingPercent")) * 100} for r in result.get("topHoldings", {}).get("holdings", []) if number(r.get("holdingPercent")) is not None]
        expense = number(profile.get("annualReportExpenseRatio"))
        dy = number(detail.get("yield"))
        return package("Yahoo Finance 펀드 공시 요약", holdings, code=code, name=code, region=region, currency="USD", holdings_date=None,
                       expense_pct=expense * 100 if expense is not None else None, nav=number(detail.get("navPrice")), yield_pct=dy * 100 if dy is not None else None,
                       coverage="공개된 상위 보유종목 부분집합. 전체 포트폴리오나 같은 기준일을 보장하지 않습니다.", source_url=f"https://finance.yahoo.com/quote/{code}/holdings/")
    return cache.get_or_set(f"discovery:fund:{region}:{code}", 3600, fetch)


def parse_curve(xml):
    root = ET.fromstring(xml)
    items = []
    for prop in root.iter():
        if prop.tag.split("}")[-1] != "properties":
            continue
        row = {el.tag.split("}")[-1]: el.text for el in prop}
        date = (row.get("NEW_DATE") or "")[:10]
        if date:
            items.append({"date": date, "values": {key.removeprefix("BC_"): number(value) for key, value in row.items() if key.startswith("BC_")}})
    return sorted(items, key=lambda x: x["date"])


def curve():
    def fetch():
        year = dt.datetime.now(UTC).year
        url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
        rows = parse_curve(read(url, {"data": "daily_treasury_yield_curve", "field_tdr_date_value": year}, False))
        if len(rows) < 2:
            rows = parse_curve(read(url, {"data": "daily_treasury_yield_curve", "field_tdr_date_value": year - 1}, False)) + rows
        return package("미국 재무부 일별 Par Yield", rows[-260:], currency="USD", unit="금리 % / 차이 %p 또는 bp", source_url="https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics", coverage="미국 국채 공시 금리. 회사채 금리나 실제 매매 호가가 아닙니다.")
    return cache.get_or_set("discovery:curve", 3600, fetch)


INDICATORS = {"gdp": ("NY.GDP.MKTP.CD", "명목 GDP", "current USD"), "growth": ("NY.GDP.MKTP.KD.ZG", "실질 GDP 성장률", "% 전년 대비"), "inflation": ("FP.CPI.TOTL.ZG", "소비자물가 상승률", "% 연간"), "unemployment": ("SL.UEM.TOTL.ZS", "실업률", "% 노동력 대비")}


def macro(indicator="growth"):
    def fetch():
        key, label, unit = INDICATORS[indicator]
        year = dt.datetime.now(UTC).year
        data = read(f"https://api.worldbank.org/v2/country/KOR;USA;JPN;CHN;DEU;GBR;IND;AUS/indicator/{key}", {"format": "json", "date": f"{year-7}:{year}", "per_page": 200}, timeout=25)
        items = [{"country": r["country"]["value"], "code": r["countryiso3code"], "year": int(r["date"]), "value": number(r["value"])} for r in data[1] or []]
        return package("World Bank WDI", items, indicator=indicator, label=label, unit=unit, revised_at=data[0].get("lastupdated"), source_url=f"https://data.worldbank.org/indicator/{key}", coverage="연간 통계. 같은 연도만 나란히 비교하며 미공표 값을 다른 연도로 채우지 않습니다.")
    return cache.get_or_set(f"discovery:macro:{indicator}", 6 * 3600, fetch)


def crypto():
    def fetch():
        markets = read("https://api.upbit.com/v1/market/all")
        names = {m["market"]: m["korean_name"] for m in markets if m["market"].startswith("KRW-")}
        quotes = []
        codes = list(names)
        for i in range(0, len(codes), 100):
            quotes.extend(read("https://api.upbit.com/v1/ticker", {"markets": ",".join(codes[i:i+100])}))
        items = [{"code": r["market"], "name": names[r["market"]], "price": number(r.get("trade_price")), "change": number(r.get("signed_change_rate")) * 100 if number(r.get("signed_change_rate")) is not None else None,
                  "turnover": number(r.get("acc_trade_price_24h")), "volume": number(r.get("acc_trade_volume_24h")), "quote_at": r.get("timestamp")} for r in quotes]
        return package("Upbit 원화마켓", sorted(items, key=lambda r: -(r["turnover"] or 0)), currency="KRW", coverage="단일 거래소 원화마켓 표본. 등락률은 UTC 전일 종가 대비, 거래대금은 24시간입니다. 시가총액은 제공하지 않습니다.", source_url="https://upbit.com/exchange")
    return cache.get_or_set("discovery:crypto", 30, fetch)


def orderbook(market="KRW-BTC"):
    def fetch():
        rows = read("https://api.upbit.com/v1/orderbook", {"markets": market, "count": 30})
        if not rows:
            raise ValueError("no orderbook")
        row = rows[0]
        return package("Upbit 공개 호가", row.get("orderbook_units", []), code=market, quote_at=row.get("timestamp"), currency="KRW", coverage="수신 순간 최대 30호가. 주문·체결을 실행하지 않으며 예상 비용은 바뀔 수 있습니다.", source_url="https://docs.upbit.com/kr/reference/list-orderbooks")
    return cache.get_or_set(f"discovery:orderbook:{market}", 5, fetch)


def derivatives(code="BTCUSDT"):
    def fetch():
        base = "https://api.bybit.com/v5/market/"
        current = read(base + "tickers", {"category": "linear", "symbol": code})
        if current.get("retCode") != 0 or not current.get("result", {}).get("list"):
            raise ValueError("derivatives unavailable")
        ticker = current["result"]["list"][0]
        history = read(base + "open-interest", {"category": "linear", "symbol": code, "intervalTime": "1h", "limit": 24})
        interest = [{"time": r["timestamp"], "value": number(r.get("openInterest"))} for r in history.get("result", {}).get("list", [])]
        return package("Bybit USDT 무기한 선물", list(reversed(interest)), code=code, price=number(ticker.get("lastPrice")), index_price=number(ticker.get("indexPrice")),
                       funding_rate=number(ticker.get("fundingRate")), funding_interval_hours=number(ticker.get("fundingIntervalHour")), next_funding=ticker.get("nextFundingTime"),
                       open_interest=number(ticker.get("openInterest")), open_interest_usd=number(ticker.get("openInterestValue")),
                       coverage="선택 계약의 OI·펀딩만 제공합니다. 청산액 미제공이며 OI 단위는 기초자산 수량입니다.", source_url="https://bybit-exchange.github.io/docs/v5/market/tickers")
    return cache.get_or_set(f"discovery:derivatives:{code}", 60, fetch)


def parse_ics(text):
    text = re.sub(r"\r?\n[ \t]", "", text)
    rows = []
    for block in text.split("BEGIN:VEVENT")[1:]:
        fields = {}
        zone = "America/New_York"
        for line in block.splitlines():
            if ":" not in line:
                continue
            head, value = line.split(":", 1)
            key = head.split(";")[0]
            fields[key] = value
            if key == "DTSTART" and "TZID=" in head:
                zone = head.split("TZID=", 1)[1].split(";")[0]
        raw = fields.get("DTSTART", "")
        try:
            if len(raw) == 8:
                date = dt.datetime.strptime(raw, "%Y%m%d").date().isoformat(); timestamp = None
            else:
                stamp = dt.datetime.strptime(raw.rstrip("Z"), "%Y%m%dT%H%M%S").replace(tzinfo=UTC if raw.endswith("Z") else ZoneInfo(zone))
                date = stamp.astimezone(ZoneInfo("Asia/Seoul")).date().isoformat(); timestamp = stamp.astimezone(UTC).isoformat()
            rows.append({"date": date, "at": timestamp, "title": fields.get("SUMMARY", "").replace("\\,", ","), "source": "BEA", "source_url": "https://www.bea.gov/news/schedule", "kind": "economic", "original_zone": zone})
        except (ValueError, KeyError):
            continue
    return rows


def calendar():
    def fetch():
        url = "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics"
        text = read(url, json_response=False)
        if "BEGIN:VCALENDAR" not in text:
            raise ValueError("calendar payload was not ICS")
        rows = parse_ics(text)
        today = dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
        items = [r for r in rows if today - dt.timedelta(days=30) <= dt.date.fromisoformat(r["date"]) <= today + dt.timedelta(days=180)]
        return package("BEA 공식 발표 일정", sorted(items, key=lambda r: r["at"] or r["date"]),
                       coverage="BEA가 공개한 일정만 포함합니다. 전 세계·기업 실적 전체 캘린더가 아닙니다. 발표 시간은 한국시간으로 표시합니다.", source_url="https://www.bea.gov/news/schedule")
    return cache.get_or_set("discovery:calendar", 3600, fetch)


def sessions(start=None):
    from app.services.trading_calendar import is_trading_day, has_calendar_for
    today = dt.date.fromisoformat(start) if start else dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
    items = []
    for i in range(14):
        date = today + dt.timedelta(days=i)
        for region, zone, end_hour in [("KR", "Asia/Seoul", 15), ("US", "America/New_York", 16)]:
            valid = has_calendar_for(date, region)
            opened = is_trading_day(date, region) if valid else None
            # NYSE's published early-close pattern for the table's supported years.
            half = region == "US" and date.strftime("%Y%m%d") in {"20261127", "20261224", "20271126"}
            start_at = dt.datetime.combine(date, dt.time(9, 0 if region == "KR" else 30), ZoneInfo(zone))
            end_at = dt.datetime.combine(date, dt.time(13 if half else end_hour, 30 if region == "KR" else 0), ZoneInfo(zone))
            items.append({"date": date.isoformat(), "region": region, "open": opened, "half_day": half,
                          "start": start_at.astimezone(UTC).isoformat() if opened else None, "end": end_at.astimezone(UTC).isoformat() if opened else None, "calendar_valid": valid})
    return package("저장소 거래소 휴장표 + IANA 시간대", items, source_url="https://www.nyse.com/markets/hours-calendars", coverage="정규장만 표시합니다. 지원 연도 밖은 휴장 여부 미확인으로 남깁니다.")


def snapshots(market=None):
    items = deque(maxlen=240)
    if ARCHIVE.exists():
        with ARCHIVE.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                    if market is None or record.get("market") == market:
                        items.append(record)
                except ValueError:
                    continue
    return package("공개 시장 스냅샷 보관함", list(items), coverage="기록 버튼으로 보관한 당시 표본만 제공합니다. 과거 구성 종목을 현재 구성으로 다시 만들지 않습니다.")


def append_snapshot(market):
    with _archive_lock:
        current_time = dt.datetime.now(UTC).timestamp()
        if current_time - _last_snapshot.get(market, 0) < 600:
            return {"recorded": False, "reason": "같은 시장은 10분 후 다시 기록할 수 있습니다."}
        if os.environ.get("DISCOVERY_PREVIEW_MODE") == "1":
            board = read("https://kospimap.com/api/market/board", {"market": market, "slim": "true"})
        else:
            from app.services.stock_board import get_board
            board = get_board(market, 100, slim=True)
        rows = [{key: row.get(key) for key in ("code", "name", "sector", "close", "change_pct", "marcap", "market_cap")} for row in board.get("items", [])]
        if not rows:
            raise ValueError("no rows to record")
        record = {"id": uuid.uuid4().hex, "market": market, "recorded_at": now(), "source_at": board.get("generated_at"), "items": rows}
        ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
        with ARCHIVE.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
        _last_snapshot[market] = current_time
        return {"recorded": True, "id": record["id"], "recorded_at": record["recorded_at"]}
