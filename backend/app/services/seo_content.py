"""Public content already available to the market UI, rendered in the first HTML."""

from datetime import datetime, timezone
from html import escape
from re import fullmatch
from zoneinfo import ZoneInfo

from app.services import market_brief_store
from app.services.cache import cache
from app.services.public_markets import number

KST = ZoneInfo("Asia/Seoul")


def _table(caption: str, headers: tuple[str, ...], rows: list[tuple[str, ...]]) -> str:
    if not rows:
        return ""
    headings = "".join(f'<th scope="col">{escape(header)}</th>' for header in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f"<table><caption>{caption}</caption><thead><tr>{headings}</tr></thead><tbody>{body}</tbody></table>"


def _brief_links() -> str:
    try:
        records = cache.get_or_set("seo:recent-market-briefs", 300, lambda: market_brief_store.dates(400))
    except Exception:
        return ""
    entries = []
    for row in records:
        day, market = str(row.get("date", "")), str(row.get("market", "")).upper()
        label = {"KOSPI": "코스피", "KOSDAQ": "코스닥"}.get(market)
        try:
            parsed = datetime.fromisoformat(day)
        except ValueError:
            continue
        if label and day == parsed.date().isoformat():
            entries.append(f'<li><a href="/market-brief/{day}/{market.lower()}">{day} {label} 장 마감</a></li>')
    return '<ul>' + "".join(entries[:30]) + '</ul>' if entries else ""


def brief_archive() -> str:
    links = _brief_links()
    if not links:
        return ""
    return (
        '<section><h2>날짜별 코스피·코스닥 마감 브리핑</h2>'
        '<p>거래일별 지수 종가와 등락, 수급, 거래대금, 상승·하락 종목을 확인할 수 있습니다.</p>'
        f'{links}</section>'
    )


def closing_brief(report: dict, day: str, market: str) -> str:
    index = report.get("index") or {}
    breadth = report.get("breadth") or {}
    metrics = (
        ("종가", index.get("close"), ",.2f", "원" if report.get("target_type") == "stock" else "포인트"),
        ("전일 대비", index.get("change_pct"), "+.2f", "%"),
        ("추정 거래대금", report.get("turnover_estimate"), ",.0f", "원"),
    )
    if report.get("target_type") != "stock":
        metrics += tuple((label, breadth.get(key), ",.0f", "종목") for key, label in (
            ("advance", "상승"), ("decline", "하락"), ("flat", "보합")
        ))
    rows = [(label, f"{value:{fmt}} {unit}") for label, raw, fmt, unit in metrics if (value := number(raw)) is not None]
    table = _table("장 마감 주요 수치", ("항목", "수치"), rows)
    analysis = "".join(f"<p>{escape(point)}</p>" for point in (report.get("analysis") or []) if isinstance(point, str))
    checkpoints = "".join(f"<li>{escape(point)}</li>" for point in (report.get("checkpoints") or []) if isinstance(point, str))
    leaders = _quote_rows(report.get("active") or [])
    return (
        f'<article><p>거래일 <time datetime="{day}">{day}</time></p>{table}'
        f'{_table("거래대금 주요 종목", ("종목", "종가", "등락률"), leaders) if market in {"kospi", "kosdaq"} else ""}'
        f'<h2>장 마감 분석</h2>{analysis}'
        + (f'<h2>다음 거래일 확인 사항</h2><ul>{checkpoints}</ul>' if checkpoints else "")
        + '</article><p><a href="/market-brief">날짜별 마감 브리핑 목록</a></p>'
    )


def _quote_rows(items: list[dict]) -> list[tuple[str, str, str]]:
    rows = []
    for row in items:
        code = str(row.get("code") or "")
        close, pct = number(row.get("close")), number(row.get("change_pct"))
        if not fullmatch(r"[A-Z0-9.-]{1,16}", code) or close is None or close <= 0:
            continue
        name = escape(str(row.get("name") or code))
        change = f"{pct:+.2f}%" if pct is not None else "미제공"
        rows.append((f'<a href="/stock/{code}">{name} ({code})</a>', f"{close:,.2f}", change))
    return rows


def security_snapshot(code: str, name: str, kind: str) -> str:
    from app.data import us_live_quotes
    from app.services.etf_market import cached_etfs

    region = "KR" if kind == "kr_etf" else "US"
    stamp = ""
    item = {}
    if kind.endswith("etf"):
        board = cached_etfs(region) or {}
        item = next((row for row in board.get("items", []) if row.get("code") == code), {})
        stamp = str(board.get("updated_at") or "")
    if region == "US" and not item:
        item = us_live_quotes.latest([code]).get(code, {})
        timestamp = number(item.get("quote_time"))
        if timestamp is not None and 0 < timestamp <= datetime.now(timezone.utc).timestamp():
            stamp = datetime.fromtimestamp(timestamp, KST).isoformat(timespec="minutes")
    if not stamp and region == "KR":
        item = cache.peek(f"stock_quote:{code}", max_stale_seconds=3 * 86400) or {}
        timestamp = number(item.get("quote_time"))
        if timestamp is not None and 0 < timestamp <= datetime.now(timezone.utc).timestamp():
            stamp = datetime.fromtimestamp(timestamp, KST).isoformat(timespec="minutes")
    price = number(item.get("close"))
    if not stamp or price is None or price <= 0:
        return ""
    try:
        observed = datetime.fromisoformat(stamp).astimezone(KST).isoformat(timespec="minutes")
    except ValueError:
        return ""
    currency = escape(str(item.get("currency") or ("KRW" if region == "KR" else "USD")))
    pct = number(item.get("change_pct"))
    stats = f"가격 {price:,.2f} {currency}" + (f" · 전일 대비 {pct:+.2f}%" if pct is not None else "")
    for key, label in (("d20", "20거래일"), ("d60", "60거래일"), ("ytd", "연초 대비")):
        value = number((item.get("returns") or {}).get(key))
        if value is not None:
            stats += f" · {label} {value:+.2f}%"
    return (f'<section><h2>{escape(name)} 최근 제공 시세</h2><p>{stats}</p>'
            f'<p>제공 기준 <time datetime="{observed}">{observed[:16].replace("T", " ")} KST</time></p></section>')


def market_directory(path: str, kr_universe) -> str:
    if path == "/stocks":
        items = []
        for row in kr_universe():
            code = str(row.get("code") or "")
            if not (len(code) == 6 and code.isascii() and code.isdecimal()):
                continue
            items.append(f'<li><a href="/stock/{code}">{escape(str(row.get("name") or code))} ({code})</a></li>')
            if len(items) == 100:
                break
        return "<section><h2>시가총액 상위 국내 종목</h2><ul>" + "".join(items) + "</ul></section>" if items else ""
    if path == "/dram-price":
        from app.services.dram_price import get_latest

        try:
            data = get_latest()
        except Exception:
            return ""
        rows = []
        for item in data.get("items", []):
            price = number(item.get("price"))
            if price is not None:
                pct = number(item.get("change_pct"))
                rows.append((escape(str(item.get("item_name") or "")), f"{price:,.3f}", f"{pct:+.2f}%" if pct is not None else "미제공"))
        return _table("TrendForce 메모리 현물 가격 (" + escape(str(data.get("price_date") or "")) + ")",
                      ("메모리 품목", "평균 가격 (USD)", "등락률"), rows)
    if path == "/global":
        from app.data.us_index_fetcher import cached_sp500_quotes

        quotes = cached_sp500_quotes()
        return _table("미국 주요 종목 최근 제공 시세", ("종목", "가격 (USD)", "등락률"), _quote_rows(quotes[:20]))

    from app.services.etf_market import cached_etfs

    region = path.rsplit("/", 1)[-1].upper()
    board = cached_etfs(region) or {}
    currency = "KRW" if region == "KR" else "USD"
    caption = ("국내" if region == "KR" else "미국") + " ETF 거래대금 상위"
    return _table(caption, ("ETF", f"가격 ({currency})", "등락률"), _quote_rows(board.get("items", [])[:20]))


def immersive_market_links(path: str) -> str:
    markets = (
        ("kospi", "코스피", "/map", "/kospi-100"),
        ("kosdaq", "코스닥", "/kosdaq-map", "/kosdaq-100"),
        ("nasdaq100", "나스닥100", "/nasdaq100-map", "/nasdaq-100"),
    )
    sections = []
    for market, label, map_path, ranking_path in markets:
        if path.endswith("-orbit") and path != f"/{market}-orbit":
            continue
        value = cache.peek(f"public_market:v1:{market}", max_stale_seconds=3600) or {}
        rows = _quote_rows(value.get("largest", [])[:6])
        table = _table(f"{label} 시가총액 상위 시세", ("종목", f'가격 ({value.get("currency", "")})', "등락률"), rows)
        sections.append(
            f'<section><h2>{label} 시세와 종목 순위</h2>{table}'
            f'<p><a href="{map_path}">{label} 2D 시가총액 지도</a> · '
            f'<a href="{ranking_path}">{label} 상위 100 종목 표</a></p></section>'
        )
    return "".join(sections)
