import json

from app.data import kr_etf_directory as directory
from app.routers import search as search_router

PAYLOAD = json.dumps(
    {"result": {"etfItemList": [
        {"itemcode": "465580", "itemname": "ACE 미국빅테크TOP7 Plus"},
        {"itemcode": "0091C0", "itemname": "KODEX 미국10년국채액티브(H)"},
        {"itemcode": "466920", "itemname": "SOL 조선TOP3플러스"},
    ]}},
    ensure_ascii=False,
).encode("euc-kr")


def test_parse_and_search(monkeypatch):
    rows = directory.parse(PAYLOAD)
    assert [r["code"] for r in rows] == ["465580", "0091C0", "466920"]
    monkeypatch.setattr(directory, "get_listings", lambda: rows)
    assert [r["code"] for r in directory.search("sol 조선", 5)] == ["466920"]
    assert directory.search("0091c0", 5)[0]["name"].startswith("KODEX")
    assert directory.lookup("0091c0")["code"] == "0091C0"


def test_router_adds_uncurated_kr_etfs_only_with_include_etf(monkeypatch):
    monkeypatch.setattr(directory, "get_listings", lambda: directory.parse(PAYLOAD))
    monkeypatch.setattr(search_router, "search_stocks", lambda q, limit: [])
    monkeypatch.setattr(search_router, "search_us_stocks", lambda q, limit: [])
    monkeypatch.setattr(search_router.us_listing_directory, "lookup", lambda code: None)
    hits = search_router.search("465580", 30, True)
    assert hits == [{"code": "465580", "name": "ACE 미국빅테크TOP7 Plus", "market": "KR", "asset_type": "ETF"}]
    assert search_router.search("465580", 30, False) == []
