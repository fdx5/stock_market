from app.data import us_listing_directory as directory
from app.data import us_universe
from app.routers import search as search_router

NASDAQ = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
IONX|Defiance Daily Target 2X Long IONQ ETF|G|N|N|100|Y|N
IONL|GraniteShares 2x Long IONQ Daily ETF|G|N|N|100|Y|N
ZZZT|Test Issue Common Stock|G|Y|N|100|N|N
ABCW|Abc Corp Warrants|G|N|N|100|N|N
File Creation Time: 1123202608:00|||||||
"""
OTHER = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
IONQ|IonQ, Inc. Common Stock|N|IONQ|N|100|N|IONQ
BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK.B|N|100|N|BRK=B
ABC$A|Abc Preferred Series A|N|ABCpA|N|100|N|ABC-A
"""


def test_parse_keeps_listed_stocks_and_etfs_only():
    rows = directory.parse(NASDAQ, "Symbol", "ETF", "Test Issue") + directory.parse(
        OTHER, "ACT Symbol", "ETF", "Test Issue"
    )
    by_code = {r["code"]: r for r in rows}
    assert set(by_code) == {"IONX", "IONL", "IONQ", "BRK-B"}
    assert by_code["IONX"]["etf"] and by_code["IONX"]["name"] == "Defiance Daily Target 2X Long IONQ ETF"
    assert by_code["IONQ"]["name"] == "IonQ, Inc." and not by_code["IONQ"]["etf"]
    assert by_code["BRK-B"]["name"] == "Berkshire Hathaway Inc."


def _patch(monkeypatch):
    rows = directory.parse(NASDAQ, "Symbol", "ETF", "Test Issue") + directory.parse(
        OTHER, "ACT Symbol", "ETF", "Test Issue"
    )
    monkeypatch.setattr(directory, "get_listings", lambda: rows)
    monkeypatch.setattr(directory, "_index", lambda: {r["code"]: r for r in rows})
    monkeypatch.setattr(us_universe, "get_us_universe", lambda: [{"code": "NVDA", "name": "NVIDIA"}])
    monkeypatch.setattr(us_universe, "_get_korean_names_if_ready", lambda: {})


def test_search_finds_non_index_stocks_and_etfs(monkeypatch):
    _patch(monkeypatch)
    results = search_router.search("IONX", 30, False)
    assert results[0] == {"code": "IONX", "name": "Defiance Daily Target 2X Long IONQ ETF", "market": "US", "asset_type": "ETF"}
    codes = [r["code"] for r in search_router.search("ionq", 30, True)]
    assert codes[0] == "IONQ" and {"IONX", "IONL"} <= set(codes)
    assert us_universe.get_us_stock_item("IONL")["name"].startswith("GraniteShares")
    assert us_universe.get_us_stock_item("NOPE") is None


def test_directory_outage_keeps_curated_search(monkeypatch):
    monkeypatch.setattr(directory, "get_listings", lambda: [])
    monkeypatch.setattr(directory, "_index", lambda: {})
    monkeypatch.setattr(us_universe, "get_us_universe", lambda: [{"code": "NVDA", "name": "NVIDIA"}])
    monkeypatch.setattr(us_universe, "_get_korean_names_if_ready", lambda: {})
    assert [r["code"] for r in us_universe.search_us_stocks("NVDA")] == ["NVDA"]
