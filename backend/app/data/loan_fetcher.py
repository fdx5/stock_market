"""Per-stock daily 대차잔고, from SEIBro (한국예탁결제원).

KRX is not a source for this: its srtLoader embed is 공매도 only and the 대차 screens
sit behind the site login, and the Data Marketplace OPEN API doesn't carry 대차 at all
(see balance_fetcher's header for what was tried). SEIBro publishes it per issue and
without a key, on the WebSquare screen 주식대차 > 종목별대차거래현황:

    seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/loan/BIP_CNTS08003V.xml

WebSquare posts an XML `reqParam` document to one servlet for every screen, naming the
backing task and the grid action inside the body rather than in the URL. Two details
are worth writing down, because both answer `<vector result="0"/>` — an empty success,
not an error — when you get them wrong, which is how this looks like a dead endpoint:

  * `isin` takes the **6-digit code**, not an ISIN, despite the field name. Sending
    KR7005930003 returns nothing at all; sending 005930 returns the rows and echoes
    back "삼성전자"/"005930".
  * dates must be compact `YYYYMMDD`. `2026-05-01` and `2026/05/01` both return zero
    rows as cheerfully as a valid request returns sixty.

The paged grid action is used rather than the screen's chart: the chart answers a
single packed string (`date^|close^|balance^|...^!^!...`) whose meaning is entirely
positional, while the grid answers named fields that survive a column being added.
"""

import datetime as dt
import re
import xml.etree.ElementTree as ET

import requests

from app.services.cache import cache

# 대차잔고 is published once per session, like the 공매도 figures it sits beside.
TTL_LOAN_SECONDS = 60 * 60

_W2XPATH = "/IPORTAL/user/loan/BIP_CNTS08003V.xml"
_TASK = "ksd.safe.bip.cnts.Loan.process.StkSecnSlbPTask"
_SCREEN = f"https://seibro.or.kr/websquare/control.jsp?w2xPath={_W2XPATH}"
_SERVLET = f"https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp?w2xPath={_W2XPATH}"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}


def _to_int(text: object) -> int | None:
    """SEIBro writes plain digits, and a session it hasn't filled in yet as ''."""
    s = str(text or "").strip().replace(",", "")
    if not s or s in {"-", "--"}:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _to_date(text: object) -> str | None:
    """'20260729' -> '2026-07-29'."""
    s = re.sub(r"[^0-9]", "", str(text or ""))
    if len(s) != 8:
        return None
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def _fetch(code: str, days: int) -> dict[str, int]:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(days * 1.7) + 10)  # calendar days -> ~`days` sessions

    session = requests.Session()
    session.headers.update(_HEADERS)
    # Opening the screen first is what hands out the WMONID/JSESSIONID pair the servlet
    # expects; posting cold gets the same empty vector as a malformed request.
    session.get(_SCREEN, timeout=8).raise_for_status()

    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<reqParam action="stksecnslbPList" task="{_TASK}">'
        f'<isin value="{code}"/>'
        f'<start_date value="{start.strftime("%Y%m%d")}"/>'
        f'<end_date value="{end.strftime("%Y%m%d")}"/>'
        '<select_sorting value=""/>'
        '<START_PAGE value="1"/>'
        # One page big enough for the whole window — the grid pages for a human reader,
        # and a second round-trip to collect the tail would buy nothing.
        f'<END_PAGE value="{days + 20}"/>'
        "</reqParam>"
    )
    resp = session.post(
        _SERVLET,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/xml; charset=UTF-8", "W2XPATH": _W2XPATH, "Referer": _SCREEN},
        timeout=12,
    )
    resp.raise_for_status()

    # <vector><data><result><STD_DT value="..."/><REM_AMT value="..."/>...
    # REM_AMT is the 잔고; MATC_QTY/RED_QTY are the day's new and returned loans, and
    # CPRI/TR_QTY arrive empty on the most recent session, which is why only the 잔고 is
    # read here rather than the whole row.
    balances: dict[str, int] = {}
    root = ET.fromstring(resp.text)
    for node in root.iter("result"):
        fields = {child.tag: child.attrib.get("value") for child in node}
        date = _to_date(fields.get("STD_DT"))
        balance = _to_int(fields.get("REM_AMT"))
        if date is not None and balance is not None:
            balances[date] = balance
    return balances


def get_loan_history(code: str, days: int) -> dict[str, int]:
    """대차잔고 by session date for one stock. Empty when SEIBro is unreachable — the
    panel then shows its 공매도 series alone rather than a column of dashes, which is
    the same thing it does for a stock SEIBro has no 대차 rows for."""
    try:
        return cache.get_or_set(f"stock_loan:{code}", TTL_LOAN_SECONDS, lambda: _fetch(code, days))
    except Exception:
        return {}
