import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache

# Prices/marcap/change refresh on a short cycle so the map tracks the live session;
# the industry classification never changes intraday, so it's cached separately and
# far less often. TTLCache naturally coalesces concurrent pollers within the window
# into a single upstream KRX fetch, so a 5s TTL doesn't mean 5s of extra KRX load per
# visitor.
TTL_PRICE_SECONDS = 5
TTL_INDUSTRY_SECONDS = 24 * 3600

# KRX-DESC gives a fine-grained KSIC industry string (~100+ distinct values across the
# top names), too granular for a Finviz-style zoned map. Bucket into broad sectors via
# keyword match, ordered so more specific terms are checked first.
_SECTOR_KEYWORDS: list[tuple[str, list[str]]] = [
    ("배터리", ["전지"]),
    ("반도체/전자", [
        "전자", "반도체", "통신 및 방송 장비", "컴퓨터", "정밀기기", "전동기",
        "전기 변환", "절연선", "케이블", "가정용 기기", "영상 및 음향",
    ]),
    ("제약/바이오", ["의약", "의료", "바이오", "연구개발"]),
    ("자동차/조선", [
        "자동차", "선박", "보트", "운송장비", "항공기", "우주선", "무기", "총포탄", "조선",
    ]),
    ("금융", ["금융", "보험", "은행", "신탁", "저축기관", "연금"]),
    ("화학/소재", ["화학", "플라스틱", "고무", "유리", "시멘트", "요업", "비료", "농약"]),
    ("철강/금속", ["철강", "금속", "제철"]),
    ("기계/산업재", ["기계", "장비 임대"]),
    ("건설/부동산", ["건설", "부동산", "건축", "공사업", "축조"]),
    ("에너지/유틸리티", ["석유", "가스", "전기업", "증기", "발전"]),
    ("운송/물류", ["운송업", "여객", "화물", "여행사"]),
    ("IT서비스/미디어", [
        "소프트웨어", "프로그래밍", "정보매개", "포털", "호스팅", "통신업", "방송",
        "광고", "오락", "정보 서비스", "출판", "영화",
    ]),
    ("식품/음료", ["식품", "음료", "낙농", "수산물", "곡물", "사료", "담배"]),
    ("유통/소비재", ["소매업", "도매업", "의복", "가방", "가구", "가죽", "종이", "골판지", "방적"]),
    ("지주/서비스", ["회사 본부", "경영 컨설팅", "경비", "경호"]),
]


def _classify_sector(industry) -> str:
    if not industry or (isinstance(industry, float) and pd.isna(industry)):
        return "기타"
    for sector, keywords in _SECTOR_KEYWORDS:
        if any(kw in industry for kw in keywords):
            return sector
    return "기타"


def _load_price_snapshot() -> pd.DataFrame:
    kospi = fdr.StockListing("KOSPI")
    code_col = "Code" if "Code" in kospi.columns else "Symbol"
    return kospi.rename(columns={code_col: "Code"})


def _get_price_snapshot() -> pd.DataFrame:
    return cache.get_or_set("kospi_price_snapshot", TTL_PRICE_SECONDS, _load_price_snapshot)


def _load_industry_map() -> pd.DataFrame:
    return fdr.StockListing("KRX-DESC")[["Code", "Industry"]]


def _get_industry_map() -> pd.DataFrame:
    return cache.get_or_set("krx_industry_map", TTL_INDUSTRY_SECONDS, _load_industry_map)


def get_kospi_map(limit: int = 500) -> list[dict]:
    kospi = _get_price_snapshot()
    desc = _get_industry_map()

    merged = kospi.merge(desc, on="Code", how="left")
    merged = merged.dropna(subset=["Marcap", "Close"])
    merged = merged[merged["Marcap"] > 0]
    merged = merged.sort_values("Marcap", ascending=False).head(limit)

    items = []
    for _, row in merged.iterrows():
        items.append(
            {
                "code": str(row["Code"]),
                "name": str(row["Name"]),
                "sector": _classify_sector(row.get("Industry")),
                "marcap": float(row["Marcap"]),
                "close": float(row["Close"]),
                "change": float(row["Changes"]) if not pd.isna(row["Changes"]) else 0.0,
                "change_pct": float(row["ChagesRatio"]) if not pd.isna(row["ChagesRatio"]) else 0.0,
            }
        )
    return items
