"""Read-only distribution endpoints. Embeds have no cookies or tracking scripts."""
from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from app.services import public_markets as markets

router = APIRouter()
Market = Literal["kospi", "kosdaq", "nasdaq100"]
HEADERS = {"Cache-Control": "public, max-age=30, stale-while-revalidate=120"}


@router.get("/market-snapshot/{market}.json")
def snapshot(market: Market):
    try:
        return markets.public_payload(markets.snapshot(market))
    except Exception:
        raise HTTPException(503, "시장 데이터를 준비 중입니다. 잠시 후 다시 확인하세요.")


@router.api_route("/market-card/{market}.png", methods=["GET", "HEAD"], include_in_schema=False)
def market_card(market: Market):
    try:
        value = markets.snapshot(market)
        key = f'public_market_card:{market}'
        payload = markets.cache.get_or_set(key, 60, lambda: markets.card_png(value))
        return Response(payload, media_type="image/png", headers=HEADERS)
    except Exception:
        raise HTTPException(503, "시장 카드를 준비 중입니다.")


@router.api_route("/embed/market/{market}", methods=["GET", "HEAD"], include_in_schema=False)
def widget(market: Market):
    try:
        value = markets.snapshot(market)
    except Exception:
        value = None
    return HTMLResponse(markets.widget_html(market, value), headers={**HEADERS, "X-Robots-Tag": "noindex, follow",
        "Content-Security-Policy": "default-src 'none'; style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; frame-ancestors *; base-uri 'none'; form-action 'none'"})


@router.get("/market-check.ics", include_in_schema=False)
def reminder():
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KOSPIMAP//Market Check//KO", "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT", "UID:weekday-market-check@kospimap.com", "DTSTAMP:20261025T000000Z",
        "DTSTART:20261026T073000Z", "DTEND:20261026T074000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "SUMMARY:KOSPIMAP 시장 흐름 확인", "DESCRIPTION:평일 한국시간 16시30분 시장 확인. 휴장일에도 알림이 표시될 수 있습니다.",
        "URL:https://kospimap.com/today?utm_source=calendar&utm_medium=reminder&utm_campaign=weekday_check",
        "BEGIN:VALARM", "TRIGGER:-PT5M", "ACTION:DISPLAY", "DESCRIPTION:시장 흐름 확인", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", "",
    ]
    body = markets.calendar_lines(lines)
    return Response(body, media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="kospimap-market-check.ics"'})


@router.get("/market-feed.xml", include_in_schema=False)
def brief_feed():
    from app.services import market_brief_store
    try:
        body = markets.cache.get_or_set("public_market_brief_feed:v1", 300, lambda: markets.brief_feed(market_brief_store.dates(60)))
        return Response(body, media_type="application/rss+xml; charset=utf-8", headers={"Cache-Control": "public, max-age=300"})
    except Exception:
        raise HTTPException(503, "브리핑 피드를 잠시 후 다시 확인해 주세요.")
