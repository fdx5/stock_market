"""Recent NASDAQ listings (Anthropic, ANT) reach the maps, search and detail lookup
before either index scrape carries them, and never appear twice once it does."""

from app.data import us_universe
from app.services import us_market_map


ANT_QUOTE = {
    "close": 97.17,
    "change": 14.17,
    "change_pct": 17.07,
    "market_cap": 1_271_631_970_304,
    "session": "regular",
    "regular_close": 97.17,
}


def _roster():
    return [
        {"code": "AAPL", "name": "Apple", "sector": "Information Technology", "marcap": 7.0, "close": 1, "change": 0, "change_pct": 0},
        {"code": "MU", "name": "Micron", "sector": "Information Technology", "marcap": 1.0, "close": 1, "change": 0, "change_pct": 0},
    ]


def _patch(monkeypatch, quotes):
    monkeypatch.setattr(us_market_map, "_get_recent_listing_quotes", lambda: quotes)
    monkeypatch.setattr(us_market_map, "_skhynix_tile", lambda *a, **k: None)


def test_ant_tile_is_sized_against_the_benchmark(monkeypatch):
    _patch(monkeypatch, {"quotes": {"ANT": ANT_QUOTE}, "benchmark_marketcap_usd": 780e9})
    monkeypatch.setattr(us_market_map, "get_sp500_map", lambda limit, fresh=False: _roster())
    items = us_market_map.get_sp500_map_with_skhynix()
    ant = next(it for it in items if it["code"] == "ANT")
    # MU is 1% of the index at $780bn, so the index is $78tn and ANT ~1.63%.
    assert abs(ant["marcap"] - 1_271_631_970_304 / 78e12 * 100) < 1e-9
    assert ant["sector"] == "Information Technology"
    assert ant["name"] == "Anthropic"
    assert ant["close"] == 97.17


def test_ant_is_not_duplicated_once_the_index_lists_it(monkeypatch):
    _patch(monkeypatch, {"quotes": {"ANT": ANT_QUOTE}, "benchmark_marketcap_usd": 780e9})
    roster = _roster() + [{"code": "ANT", "name": "Anthropic", "sector": "Information Technology", "marcap": 3.0, "close": 1, "change": 0, "change_pct": 0}]
    monkeypatch.setattr(us_market_map, "get_nasdaq100_map", lambda limit, fresh=False: roster)
    items = us_market_map.get_nasdaq100_map_with_skhynix()
    assert [it["code"] for it in items].count("ANT") == 1


def test_quote_miss_drops_only_the_tile(monkeypatch):
    _patch(monkeypatch, {"quotes": {}, "benchmark_marketcap_usd": None})
    monkeypatch.setattr(us_market_map, "get_sp500_map", lambda limit, fresh=False: _roster())
    assert [it["code"] for it in us_market_map.get_sp500_map_with_skhynix()] == ["AAPL", "MU"]


def test_search_and_detail_resolve_ant(monkeypatch):
    monkeypatch.setattr(us_universe, "get_us_universe", us_universe._load_us_universe)
    monkeypatch.setattr(us_universe, "get_sp500_constituents", lambda: _roster())
    monkeypatch.setattr(us_universe, "get_nasdaq100_constituents", lambda: [])
    monkeypatch.setattr(us_universe, "_get_korean_names_if_ready", lambda: None)
    assert us_universe.get_us_stock_item("ANT")["name"] == "Anthropic"
    assert us_universe.search_us_stocks("앤트로픽")[0]["code"] == "ANT"
    assert us_universe.search_us_stocks("anthropic")[0]["code"] == "ANT"
