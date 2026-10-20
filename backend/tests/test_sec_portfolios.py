import pytest

from app.data import sec_portfolios as sec
from app.services import editorial


def xml_position(cusip="123456789", value=1000, shares=10, option="", title="COM"):
    return f'<infoTable><nameOfIssuer>Example</nameOfIssuer><titleOfClass>{title}</titleOfClass><cusip>{cusip}</cusip><value>{value}</value><shrsOrPrnAmt><sshPrnamt>{shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>{f"<putCall>{option}</putCall>" if option else ""}</infoTable>'


def test_full_sec_parser_preserves_options_preferred_and_unknown_ticker():
    document = '<informationTable xmlns="urn:sec">' + xml_position() + xml_position("987654321", 8000, 80, "Put") + xml_position("555555555", 1000, 5, title="PREF A") + '</informationTable>'
    rows = sec.parse_positions(document, {("123456789", ""): "AAA", ("987654321", "put"): "BBB"}, "2025-11-03")
    assert len(rows) == 3
    assert sum(r["weight_pct"] for r in rows) == 100
    assert rows[0]["asset_type"] == "put" and rows[0]["weight_pct"] == 80
    assert rows[0]["reference_price"] is None and rows[0]["purchase_price"] is None
    assert rows[-1]["code"] == "" and rows[-1]["asset_type"] == "preferred"


def test_same_issuer_equity_and_option_are_distinct_positions():
    document = '<informationTable>' + xml_position() + xml_position(option="Put") + '</informationTable>'
    rows = sec.parse_positions(document, {("123456789", ""): "AAA", ("123456789", "put"): "AAA"}, "2025-11-03")
    assert len({r["position_id"] for r in rows}) == 2


def test_sec_value_units_and_other_manager_aggregation():
    document = '<informationTable>' + xml_position() + xml_position() + '</informationTable>'
    rows = sec.parse_positions(document, {}, "2025-11-03")
    assert rows[0]["shares"] == 20 and rows[0]["reported_value"] == 2000
    assert sec.parse_positions(document, {}, "2022-11-03")[0]["reported_value"] == 2000000


def test_quarter_comparison_includes_exited_and_previous_weights():
    base = {"name": "Example", "purchase_price": None, "asset_type": "equity"}
    current = [{**base, "position_id": "A", "shares": 20, "weight_pct": 75}, {**base, "position_id": "C", "shares": 10, "weight_pct": 25}]
    previous = [{**base, "position_id": "A", "shares": 10, "weight_pct": 40}, {**base, "position_id": "B", "shares": 20, "weight_pct": 60, "reported_value": 100}]
    held, exited = sec.compare_positions(current, previous)
    assert held[0]["activity"] == "add" and held[0]["shares_change_pct"] == 100
    assert held[0]["previous_weight_pct"] == 40 and held[0]["weight_change_pct"] == 35
    assert held[1]["activity"] == "new"
    assert exited[0]["position_id"] == "B" and exited[0]["activity"] == "sold"
    assert exited[0]["weight_pct"] == 0 and exited[0]["previous_weight_pct"] == 60


def test_recent_filings_select_distinct_quarters_and_skip_partial_amendments():
    recent = {"form": ["13F-HR/A", "13F-HR", "13F-HR"], "accessionNumber": ["0000000001-26-000003", "0000000001-26-000002", "0000000001-26-000001"], "reportDate": ["2026-06-30", "2026-06-30", "2026-03-31"], "filingDate": ["2026-08-15", "2026-08-14", "2026-05-15"]}
    assert [r["accession"] for r in sec.recent_filings({"filings": {"recent": recent}})] == ["0000000001-26-000002", "0000000001-26-000001"]


def test_no_live_quote_never_reuses_quarter_reference_as_current_price(monkeypatch):
    monkeypatch.setattr(editorial, "ensure", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "recover_missing", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "latest", lambda _: {})
    row = {"code": "TSLA", "position_id": "111:equity", "name": "Tesla", "shares": 10, "reported_value": 1000, "reference_price": 100, "snapshot_price": None, "asset_type": "equity", "weight_pct": 100, "activity": "hold"}
    monkeypatch.setattr(editorial, "_snapshots", {"investors": {"items": [{"id": "wood", "coverage_version": sec.VERSION, "holdings": [row]}]}})
    result = editorial.get_portfolio("wood")
    assert result["holdings"][0]["current_price"] is None
    assert result["holdings"][0]["daily_change_pct"] is None
    assert result["holdings"][0]["reference_return_pct"] is None


def test_option_underlying_quote_is_never_presented_as_option_price_or_profit(monkeypatch):
    monkeypatch.setattr(editorial, "ensure", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "recover_missing", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "latest", lambda _: {"PLTR": {"close": 150, "change_pct": 3}})
    row = {"code": "PLTR", "position_id": "111:put", "name": "Palantir", "shares": 10, "reported_value": 1000, "reference_price": None, "asset_type": "put", "weight_pct": 100, "activity": "new"}
    monkeypatch.setattr(editorial, "_snapshots", {"investors": {"items": [{"id": "burry", "coverage_version": sec.VERSION, "holdings": [row]}]}})
    result = editorial.get_portfolio("burry")
    option = result["holdings"][0]
    assert option["current_price"] is None and option["current_value"] is None
    assert option["underlying_price"] == 150
    assert option["reference_return_pct"] is None and result["estimated_equity_value"] is None


def test_cached_daily_fund_is_preserved_but_never_shown_as_the_new_quarterly_scope(monkeypatch):
    monkeypatch.setattr(editorial, "ensure", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "recover_missing", lambda _: None)
    monkeypatch.setattr(editorial.us_live_quotes, "latest", lambda _: {})
    saved = {"id": "wood", "data_basis": "daily_fund", "holdings": [{"code": "TSLA", "weight_pct": 100}]}
    monkeypatch.setattr(editorial, "_snapshots", {"investors": {"items": [saved]}})
    assert editorial.get_portfolio("wood")["holdings"] == []
    assert saved["holdings"][0]["code"] == "TSLA"
