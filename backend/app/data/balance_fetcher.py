"""Per-stock daily 공매도 수급, behind `/api/stock/{code}/balance`.

Sourced from the KRX screen loader that Naver Finance's own 공매도 tab embeds:

    finance.naver.com/item/short_trade.naver?code=005930
      └ <iframe src="data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=...&isuCd=...">

That matters, because the rest of data.krx.co.kr moved behind a login — every
statistics screen now answers `alert('로그인 또는 회원가입이 필요합니다.')` and the
generic `getJsonData.cmd` answers a bare `LOGOUT`. This `/comm/srt/srtLoader/` path
is the exception: Naver serves it to anonymous visitors, so it cannot require one.

The two-step is KRX's own: fetching the loader registers that screen against the
session, which is what authorizes the JSON call that follows. Calling the JSON
endpoint cold — which is what every "just POST the bld" recipe does — is exactly
what earns the LOGOUT.

대차잔고 comes from SEIBro instead, merged in by session date — see `loan_fetcher`,
which explains why KRX cannot serve it.

WHY THE OTHER TWO 잔고 SERIES ARE NOT HERE — 공매도잔고 and 신용융자잔고. Neither is
reachable for free, so the panel ships the figures it can stand behind rather than a
column of nulls:

  * 공매도잔고. KRX's own 잔고 screens are the login-walled ones — MDCSTAT307/310
    answer `LOGOUT` on the JSON call. The one public 잔고 screen, MDCSTAT305
    (개별종목 공매도 순보유잔고), loads but is hollowed out: it answers 0 rows for
    every searchType/mktTpCd/date combination its own form offers, 전종목 included.
    The 종합정보 screen (MDCSTAT300) is the same story from the other side — its grid
    defines SRTSELL_QTY/SRTSELL_AMT columns, but the public `_OUT` variant returns
    them as `STR_CONST_VAL1`/`STR_CONST_VAL2`, a literal "-". KRX blanks the 잔고 on
    the anonymous embed deliberately; there is no parameter that turns it back on.
  * 신용융자잔고. Not published per-stock for free anywhere: Naver (desktop and
    mobile API), Daum and FnGuide don't carry the field, 금융투자협회's freesis
    publishes 신용공여 for the market rather than per issue, and the per-issue figure
    sits behind the KRX login or a broker account.

The KRX Data Marketplace OPEN API (`data-dbg.krx.co.kr/svc/apis/...`, the one
`KRX_API_KEY` is issued for) is not a way around any of this: its catalogue is 시세
and 종목기본정보 only — 지수/주식/증권상품/채권/파생상품/일반상품/ESG — and every
`srt`-shaped path under it 404s.

The response keeps room for all three anyway. `SERIES_UNITS` names each field and
the frontend renders whatever series it is handed, so wiring a source later is a
change to this module alone.
"""

import datetime as dt
import re

import requests

from app.data import loan_fetcher
from app.services.cache import cache

# One completed session per day. There is no intraday tick of this — the figure is
# published once, after the close — so a short TTL would only re-fetch the same rows.
TTL_BALANCE_SECONDS = 60 * 60

# Trading days to keep. Long enough for the list to show a trend without making the
# first paint of the modal wait on a big parse.
BALANCE_DAYS = 60

_BASE = "https://data.krx.co.kr"
_LOADER = f"{_BASE}/comm/srt/srtLoader/index.cmd"
_JSON = f"{_BASE}/comm/bldAttendant/getJsonData.cmd"

# (screenId, bld) per screen. The bld is NOT derivable from the screenId — the public
# embed variants live under MDC_OUT with an _OUT suffix and their own numbering
# (MDCSTAT301 -> MDCSTAT30102_OUT), which is why each screen is opened first and its
# own bld read off the page rather than guessed. Verified by hand.
#
# MDCSTAT301 is the per-stock 공매도 거래 screen. Its *second* grid (30102) is the one
# that carries the day's total volume alongside the short volume, which is what makes
# 비중 available without a second request — 30101 omits both.
_SCREEN = ("MDCSTAT301", "dbms/MDC_OUT/STAT/srt/MDCSTAT30102_OUT")

# Unit per series, in display order. This doubles as the field list: the fetcher emits
# exactly these keys, the router computes a per-session move for each, and the frontend
# formats by the unit — "주" and "원" as grouped integers, "%" to two decimals.
#
# The 잔고 series the header above explains are deliberately absent rather than present
# and null: an empty column reads as "no short interest", which is a different and
# wrong claim.
SERIES_UNITS: dict[str, str] = {
    "short_volume": "주",
    "short_weight": "%",
    "short_value": "원",
    # From SEIBro rather than KRX, so it is the one series that can be absent while the
    # rest are present.
    "loan": "주",
    "uptick_applied": "주",
    "uptick_exempt": "주",
}

# KRX's field name per series, as that screen spells them.
_FIELDS = {
    "short_volume": "CVSRTSELL_TRDVOL",
    "short_weight": "TRDVOL_WT",
    "short_value": "CVSRTSELL_TRDVAL",
    "uptick_applied": "UPTICKRULE_APPL_TRDVOL",
    "uptick_exempt": "UPTICKRULE_EXCPT_TRDVOL",
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
    # Naver is who the loader expects to be embedded by; sending anything else has no
    # reason to be honoured and every reason not to be.
    "Referer": "https://finance.naver.com/",
}


def _isin(code: str) -> str:
    """6-digit KRX code -> its 12-character ISIN, which is what the screen keys on.

    Derived rather than looked up: a KRX common-stock ISIN is "KR7" + the code + "00"
    + an ISO 6166 check digit, so there is nothing to fetch and nothing to keep in
    sync. Verified against 005930/086520/035250, whose real ISINs are KR7005930003,
    KR7086520004 and KR7035250000.
    """
    base = f"KR7{code}00"
    # ISO 6166: expand letters to their two-digit ordinals (A=10), then Luhn mod 10.
    digits = "".join(str(ord(c) - 55) if c.isalpha() else c for c in base)
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2 == 0:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return f"{base}{(10 - total % 10) % 10}"


def _to_number(text: object, unit: str) -> float | int | None:
    """KRX writes figures as '1,234,567' and blanks as '-' or ''.

    Counts come back as int and ratios as float, so a 비중 of 1.21 is not silently
    truncated to 1 by the same parser that reads a share count.
    """
    s = str(text or "").strip().replace(",", "")
    if not s or s in {"-", "--"}:
        return None
    try:
        value = float(s)
    except ValueError:
        return None
    return round(value, 2) if unit == "%" else int(value)


def _to_date(text: object) -> str | None:
    """'2026/07/29' or '20260729' -> '2026-07-29'."""
    s = re.sub(r"[^0-9]", "", str(text or ""))
    if len(s) != 8:
        return None
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def _fetch(code: str, isin: str) -> list[dict]:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(BALANCE_DAYS * 1.7) + 10)  # calendar days -> ~60 sessions

    screen_id, bld = _SCREEN
    session = requests.Session()
    session.headers.update(_HEADERS)

    # Step 1 — open the screen. KRX registers it against the session here, and that
    # registration is the whole difference between step 2 returning rows and returning
    # a bare `LOGOUT`. Skipping it is why every "just POST the bld" recipe fails
    # against this host.
    session.get(_LOADER, params={"screenId": screen_id, "isuCd": code}, timeout=6).raise_for_status()

    # Step 2 — the same call the loaded screen makes for its own grid.
    resp = session.post(
        _JSON,
        data={
            "bld": bld,
            "locale": "ko_KR",
            # This screen wants the 12-character ISIN, not the 6-digit code the loader
            # above is keyed by.
            "isuCd": isin,
            "isuCd2": code,
            "strtDd": start.strftime("%Y%m%d"),
            "endDd": end.strftime("%Y%m%d"),
            "share": "1",
            "money": "1",
            "csvxls_isNo": "false",
        },
        headers={
            "X-Requested-With": "XMLHttpRequest",
            "Origin": _BASE,
            "Referer": f"{_LOADER}?screenId={screen_id}&isuCd={code}",
        },
        timeout=8,
    )
    resp.raise_for_status()
    payload = resp.json()

    # KRX names the row list differently per screen (OutBlock_1, output, block1), so it
    # is found by shape rather than by key.
    rows: list[dict] = []
    for value in payload.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            rows = value
            break

    # 대차잔고 rides along from SEIBro, keyed by the same session date. It is fetched
    # and cached on its own, so a SEIBro outage costs the 대차 column and nothing else.
    loans = loan_fetcher.get_loan_history(code, BALANCE_DAYS)

    parsed: list[dict] = []
    for row in rows:
        date = _to_date(row.get("TRD_DD"))
        if date is None:
            continue
        entry: dict = {"date": date}
        for series, unit in SERIES_UNITS.items():
            field = _FIELDS.get(series)
            entry[series] = _to_number(row.get(field), unit) if field else None
        entry["loan"] = loans.get(date)
        parsed.append(entry)

    # Newest first — the order the list is read in, decided here so the frontend never
    # has to re-sort what it was handed. KRX already sorts this screen that way; sorting
    # again costs nothing and stops the whole panel from inverting if it ever stops.
    parsed.sort(key=lambda r: r["date"], reverse=True)
    return parsed[:BALANCE_DAYS]


def get_balance_history(code: str) -> list[dict]:
    """Daily 공매도 수급 for one stock, newest first. Empty when the source is
    unreachable — the button that opens this simply doesn't render, which is the
    honest outcome for a panel with nothing in it."""
    try:
        return cache.get_or_set(
            f"stock_balance:{code}", TTL_BALANCE_SECONDS, lambda: _fetch(code, _isin(code))
        )
    except Exception:
        return []
