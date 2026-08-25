"""Korean names for the US companies a Korean news search has to be asked about.

The 종목정보 page's 뉴스 tab searches Naver for the company by name, and Korean
coverage of a US company is filed under its Korean name: articles about NVIDIA say
엔비디아, and asking Naver for "NVIDIA Corp" finds a thinner, noisier slice of the same
day's reporting — English-language wire copy from Korean outlets, mostly.

There is already a translation path for this (us_universe.get_korean_names_ready,
which feeds the NASDAQ board's `name_ko`), and it is tried first. But it is a scraper
of a free endpoint that currently returns its input unchanged, so on this data it
yields "NVIDIA Corp" for NVIDIA Corp — a fallback that fails silently and looks like
success. A table cannot fail that way.

Deliberately not 500 rows. These are the names by capitalisation that a reader
scrolling a cap-ranked list actually opens; past them, TICKER_SUFFIXES below strips
"Corp"/"Inc"/"& Co" and Naver's own query understanding does a serviceable job
("Broadcom" does find 브로드컴). Adding a row here is how a name that reads badly gets
fixed, and is the reason this is a table and not a regex.
"""

from __future__ import annotations

import re

# Ticker -> the name Korean press uses. Keyed by ticker, not by company name, because
# the upstream's company names are not stable strings ("Coca-Cola Co/The") while the
# ticker is the identity the rest of the app already routes on.
KOREAN_NAMES: dict[str, str] = {
    "NVDA": "엔비디아",
    "AAPL": "애플",
    "GOOGL": "구글 알파벳",
    "GOOG": "구글 알파벳",
    "MSFT": "마이크로소프트",
    "AMZN": "아마존",
    "AVGO": "브로드컴",
    "META": "메타 플랫폼스",
    "TSLA": "테슬라",
    "LLY": "일라이 릴리",
    "BRK.B": "버크셔 해서웨이",
    "MU": "마이크론",
    "JPM": "JP모건",
    "WMT": "월마트",
    "AMD": "AMD",
    "V": "비자카드",
    "XOM": "엑슨모빌",
    "JNJ": "존슨앤드존슨",
    "MA": "마스터카드",
    "ABBV": "애브비",
    "INTC": "인텔",
    "BAC": "뱅크오브아메리카",
    "CSCO": "시스코",
    "COST": "코스트코",
    "PLTR": "팔란티어",
    "ORCL": "오라클",
    "CVX": "셰브런",
    "KO": "코카콜라",
    "LRCX": "램리서치",
    "AMAT": "어플라이드 머티어리얼즈",
    "CAT": "캐터필러",
    "MRK": "머크",
    "UNH": "유나이티드헬스",
    "GE": "GE 에어로스페이스",
    "PG": "P&G 프록터앤드갬블",
    "HD": "홈디포",
    "MS": "모건스탠리",
    "NFLX": "넷플릭스",
    "GS": "골드만삭스",
    "PM": "필립모리스",
    "PANW": "팔로알토 네트웍스",
    "RTX": "RTX 레이시온",
    "DELL": "델 테크놀로지스",
    "WFC": "웰스파고",
    "GEV": "GE 버노바",
    "AMGN": "암젠",
    "ANET": "아리스타 네트웍스",
    "KLAC": "KLA",
    "TXN": "텍사스 인스트루먼트",
    "TMO": "써모피셔",
    "AXP": "아메리칸 익스프레스",
    "LIN": "린데",
    "C": "씨티그룹",
    "SNDK": "샌디스크",
    "IBM": "IBM",
    "VZ": "버라이즌",
    "MRVL": "마벨 테크놀로지",
    "ABT": "애보트",
    "PEP": "펩시코",
    "SCHW": "찰스슈왑",
    "BA": "보잉",
    "QCOM": "퀄컴",
    "ADBE": "어도비",
    "CRM": "세일즈포스",
    "NOW": "서비스나우",
    "UBER": "우버",
    "DIS": "디즈니",
    "MCD": "맥도날드",
    "NKE": "나이키",
    "SBUX": "스타벅스",
    "PFE": "화이자",
    "T": "AT&T",
    "F": "포드",
    "GM": "제너럴모터스",
    "COIN": "코인베이스",
    "MSTR": "마이크로스트래티지",
    "SMCI": "슈퍼마이크로컴퓨터",
    "ON": "온세미컨덕터",
    "ADI": "아나로그디바이스",
    "SKHY": "SK하이닉스",
}

# Corporate-form noise. A Naver query is a bag of words, so leaving "Inc" on the end
# widens the match rather than narrowing it — "Tesla Inc" matches articles containing
# "Inc" as readily as ones about Tesla.
_SUFFIXES = re.compile(
    r"\s*(,)?\s*\b(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|PLC|LP|LLC|NV|SA|AG|Holdings?|Group|Class [A-C])\b\.?",
    re.IGNORECASE,
)
# The upstream tags a handful of names with an exchange or share-class qualifier
# ("Coca-Cola Co/The", "Sandisk Corp/DE"), which is never part of a searchable name.
_QUALIFIER = re.compile(r"/[A-Za-z]+$")


def english_search_name(name: str) -> str:
    """"Coca-Cola Co/The" -> "Coca-Cola". The fallback query for an uncurated ticker."""
    cleaned = _QUALIFIER.sub("", name or "").strip()
    cleaned = _SUFFIXES.sub("", cleaned).strip(" ,&")
    return cleaned or (name or "").strip()


def news_query(code: str, name: str, translated: str | None = None) -> str:
    """What to ask Naver for news about this company, best source first.

    `translated` is us_universe's cached machine translation, used only when it
    actually produced Korean — it returns its input unchanged when the upstream is
    unavailable, and an English string arriving here would otherwise displace the
    curated Korean name for no gain.
    """
    curated = KOREAN_NAMES.get((code or "").upper())
    if curated:
        return curated
    if translated and _has_hangul(translated):
        return translated
    return english_search_name(name)


def _has_hangul(text: str) -> bool:
    return any("가" <= ch <= "힣" for ch in text)
