"""Complete public SEC 13F positions and prior-quarter changes.

Values for options describe underlying notional, never option premium or profit.
SEC supplies amounts; the publicly rendered 13f.info table supplies CUSIP symbols.
"""
import datetime as dt
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

UTC = dt.timezone.utc
HEADERS = {"User-Agent": "KStockHub public portfolio research https://kospimap.com"}
VERSION = "sec-full-positions-v1"


def get(url: str):
    response = requests.get(url, headers=HEADERS, timeout=15)
    response.raise_for_status()
    return response


def recent_filings(submissions: dict) -> list[dict]:
    recent = submissions.get("filings", {}).get("recent", {})
    rows = []
    for i, form in enumerate(recent.get("form", [])):
        if form not in ("13F-HR", "13F-HR/A"):
            continue
        accession = recent["accessionNumber"][i]
        report_date = recent["reportDate"][i]
        if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", report_date):
            continue
        # A partial amendment cannot safely replace an original complete filing.
        if form.endswith("/A"):
            continue
        if report_date not in {r["report_date"] for r in rows}:
            rows.append({"accession": accession, "report_date": report_date, "filed_at": recent["filingDate"][i]})
    return sorted(rows, key=lambda row: row["report_date"], reverse=True)[:2]


def symbol_map(document: dict) -> dict:
    result = {}
    for row in document.get("data", []):
        if len(row) < 9:
            continue
        code = row[0] or ""
        if re.fullmatch(r"[A-Z0-9.\-]{1,15}", code):
            result[(str(row[3]), str(row[8] or "").lower())] = code
    return result


def parse_positions(document: str, symbols: dict, filed_at: str) -> list[dict]:
    root = ET.fromstring(document)
    positions = {}
    multiplier = 1 if filed_at >= "2023-01-03" else 1000
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] != "infoTable":
            continue
        fields = {child.tag.rsplit("}", 1)[-1]: (child.text or "").strip() for child in node.iter() if len(child) == 0}
        cusip, option = fields.get("cusip", ""), fields.get("putCall", "").lower()
        try:
            value, quantity = int(fields.get("value", "")) * multiplier, int(fields.get("sshPrnamt", ""))
        except ValueError:
            continue
        if not re.fullmatch(r"[A-Z0-9*@#]{9}", cusip) or value < 0 or quantity <= 0:
            continue
        security_class = fields.get("titleOfClass", "")
        kind = option if option in ("put", "call") else "preferred" if re.search(r"PREF|PFD", security_class, re.I) else "bond" if fields.get("sshPrnamtType") == "PRN" else "equity"
        key = cusip + ":" + kind
        if key not in positions:
            positions[key] = {"position_id": key, "cusip": cusip, "code": symbols.get((cusip, option), ""),
                              "name": fields.get("nameOfIssuer", cusip), "security_class": security_class,
                              "asset_type": kind, "shares": 0, "reported_value": 0, "purchase_price": None,
                              "reference_price": None, "snapshot_price": None}
        positions[key]["shares"] += quantity
        positions[key]["reported_value"] += value
    if not positions:
        raise ValueError("No valid SEC positions")
    total = sum(row["reported_value"] for row in positions.values())
    if not total:
        raise ValueError("Empty SEC reported value")
    for row in positions.values():
        row["weight_pct"] = round(row["reported_value"] / total * 100, 4)
        if row["asset_type"] in ("equity", "preferred"):
            row["reference_price"] = row["reported_value"] / row["shares"]
    return sorted(positions.values(), key=lambda row: (-row["reported_value"], row["position_id"]))


def compare_positions(current: list[dict], previous: list[dict]) -> tuple[list[dict], list[dict]]:
    old = {row["position_id"]: row for row in previous}
    new = {row["position_id"]: row for row in current}
    holdings = []
    for row in current:
        before = old.get(row["position_id"])
        change = row["shares"] - (before["shares"] if before else 0)
        prior_weight = before["weight_pct"] if before else 0
        holdings.append({**row, "previous_shares": before["shares"] if before else 0, "previous_weight_pct": prior_weight,
                         "weight_change_pct": round(row["weight_pct"] - prior_weight, 4),
                         "shares_change_pct": round(change / before["shares"] * 100, 2) if before else None,
                         "activity": "new" if before is None else "add" if change > 0 else "reduce" if change < 0 else "hold"})
    exited = [{**row, "previous_shares": row["shares"], "previous_weight_pct": row["weight_pct"],
               "previous_reported_value": row["reported_value"], "shares": 0, "reported_value": 0, "weight_pct": 0,
               "weight_change_pct": -row["weight_pct"], "activity": "sold", "shares_change_pct": -100}
              for row in previous if row["position_id"] not in new]
    return holdings, exited


def load_filing(cik: str, filing: dict) -> dict:
    accession = filing["accession"].replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/"
    listing = get(base + "index.json").json()
    candidates = [item["name"] for item in listing.get("directory", {}).get("item", [])
                  if re.fullmatch(r"[A-Za-z0-9_.-]+\.xml", item.get("name", "")) and item["name"].lower() != "primary_doc.xml"]
    if not candidates:
        raise ValueError("SEC information table missing")
    # Mapping is optional: retain every official security even if its ticker is unknown.
    try:
        symbols = symbol_map(get(f"https://13f.info/data/13f/{accession}").json())
    except (requests.RequestException, ValueError, TypeError):
        symbols = {}
    positions = []
    for filename in candidates:
        try:
            positions = parse_positions(get(base + filename).text, symbols, filing["filed_at"])
            break
        except (ValueError, ET.ParseError):
            continue
    if not positions:
        raise ValueError("SEC information table unreadable")
    return {**filing, "positions": positions, "source_url": base + filing["accession"] + "-index.html"}


def fetch_portfolio(profile: dict) -> dict:
    cik = profile["cik"]
    filings = recent_filings(get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json").json())
    if len(filings) < 2:
        raise ValueError("Two quarterly filings are required for comparison")
    with ThreadPoolExecutor(max_workers=2) as pool:
        latest, prior = list(pool.map(lambda row: load_filing(cik, row), filings))
    holdings, exited = compare_positions(latest["positions"], prior["positions"])
    date = dt.date.fromisoformat(latest["report_date"])
    options = [row for row in holdings if row["asset_type"] in ("put", "call")]
    return {"id": profile["id"], "period": f"Q{(date.month - 1) // 3 + 1} {date.year}", "report_date": date.isoformat(),
            "previous_report_date": prior["report_date"], "filed_at": latest["filed_at"], "source_url": latest["source_url"],
            "previous_source_url": prior["source_url"], "data_basis": "sec_13f", "coverage_version": VERSION,
            "reported_value": sum(row["reported_value"] for row in holdings), "reported_count": len(holdings),
            "holdings": holdings, "exited_holdings": exited, "has_options": bool(options),
            "option_count": len(options), "equity_count": sum(row["asset_type"] in ("equity", "preferred") for row in holdings),
            "collected_at": dt.datetime.now(UTC).isoformat()}
