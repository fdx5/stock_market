"""08:00 KST editorial editions, with additive immutable snapshot files.

No SQL, replacement, retention or deletion. Failed providers retain prior editions.
Only server-side public market data is saved; requests cannot choose file paths.
"""
import datetime as dt
import json
import logging
import os
from pathlib import Path
import threading
import time
from uuid import uuid4

from app.data import editorial_sources as source, us_live_quotes

logger = logging.getLogger(__name__)
KINDS = ("videos-kr", "videos-us", "investors")
DATA_DIR = Path(os.environ.get("EDITORIAL_DATA_DIR") or Path(__file__).resolve().parents[1] / "data" / "store" / "editorial")
_lock = threading.Lock()
_snapshots: dict[str, dict] = {}
_running: set[str] = set()
_attempted: dict[str, float] = {}
_loaded: set[str] = set()
_stop = threading.Event()
_started = False


def _load(kind: str) -> None:
    with _lock:
        if kind in _loaded: return
        _loaded.add(kind)
    for path in sorted(DATA_DIR.glob(kind + "-*.json"), reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("items") and payload.get("edition"):
                with _lock: _snapshots.setdefault(kind, payload)
                return
        except (OSError, ValueError, TypeError):
            continue


def _save(kind: str, payload: dict) -> None:
    if kind not in KINDS or not payload.get("items"):
        raise ValueError("Invalid editorial snapshot")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(source.UTC).strftime("%Y%m%dT%H%M%S%f")
    # Exclusive creation: an existing saved edition is never overwritten.
    with (DATA_DIR / f"{kind}-{stamp}-{uuid4().hex[:8]}.json").open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, allow_nan=False)


def _collect_investors(previous: dict | None) -> dict:
    from concurrent.futures import ThreadPoolExecutor, as_completed
    by_id = {item["id"]: item for item in (previous or {}).get("items", [])}
    healthy = 0
    _, cutoff = source.edition_window()
    edition = cutoff.date().isoformat()
    pending = [profile for profile in source.INVESTORS if by_id.get(profile["id"], {}).get("edition") != edition]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(source.fetch_portfolio, profile): profile for profile in pending}
        for future in as_completed(futures):
            profile = futures[future]
            try:
                data = future.result()
                old = by_id.get(profile["id"], {})
                by_id[profile["id"]] = {**old, **data, "edition": edition}
                healthy += 1
            except Exception as exc:
                logger.info("Editorial portfolio source unavailable: investor=%s type=%s", profile["id"], type(exc).__name__)
    if not healthy and pending:
        raise RuntimeError("No portfolio sources answered")
    complete = all(by_id.get(profile["id"], {}).get("edition") == edition for profile in source.INVESTORS)
    return {"edition": edition, "collected_at": dt.datetime.now(source.UTC).isoformat(), "complete": complete,
            "items": [by_id[p["id"]] for p in source.INVESTORS if p["id"] in by_id], "sources_refreshed": healthy}


def _refresh(kind: str) -> None:
    try:
        with _lock: previous = _snapshots.get(kind)
        payload = _collect_investors(previous) if kind == "investors" else source.fetch_videos(kind.split("-")[1])
        _save(kind, payload)
        with _lock: _snapshots[kind] = payload
    except Exception as exc:
        logger.info("Editorial refresh retained prior snapshot: kind=%s type=%s", kind, type(exc).__name__)
    finally:
        with _lock: _running.discard(kind)


def ensure(kind: str) -> None:
    if kind not in KINDS: raise ValueError("Unknown editorial kind")
    _load(kind)
    _, cutoff = source.edition_window()
    with _lock:
        current = _snapshots.get(kind, {})
        roster_complete = kind != "investors" or {profile["id"] for profile in source.INVESTORS}.issubset({row["id"] for row in current.get("items", [])})
        if (current.get("edition") == cutoff.date().isoformat() and current.get("complete", True) and roster_complete) or kind in _running:
            return
        now = time.monotonic()
        if kind in _attempted and now - _attempted[kind] < 15 * 60: return
        _attempted[kind] = now
        _running.add(kind)
    threading.Thread(target=_refresh, args=(kind,), name="editorial-" + kind, daemon=True).start()


def _status(kind: str, payload: dict | None) -> dict:
    _, cutoff = source.edition_window()
    with _lock: refreshing = kind in _running
    return {"status": "ready" if payload else "loading" if refreshing else "unavailable", "refreshing": refreshing,
            "stale": bool(payload and payload.get("edition") != cutoff.date().isoformat()), "next_update_at": (cutoff + dt.timedelta(days=1)).isoformat()}


def get_videos(market: str) -> dict:
    kind = "videos-" + market
    ensure(kind)
    with _lock: payload = _snapshots.get(kind)
    start, cutoff = source.edition_window()
    return {"market": market, "items": [], "edition": None, "window_start": start.isoformat(), "window_end": cutoff.isoformat(),
            **(payload or {}), **_status(kind, payload)}


def _profile(data: dict, profile: dict) -> dict:
    holdings = data.get("holdings", [])
    total = sum(row.get("weight_pct", 0) for row in holdings)
    return {**profile, **{key: value for key, value in data.items() if key != "holdings"}, **source.fetch_portrait(profile),
            "holding_count": len(holdings), "top3_weight": round(sum(row["weight_pct"] for row in holdings[:3]), 2),
            "new_count": sum(row["activity"] == "new" for row in holdings), "add_count": sum(row["activity"] == "add" for row in holdings),
            "equity_coverage_pct": round(total, 2), "top_holdings": holdings[:3], "available": bool(holdings)}


def get_investors() -> dict:
    ensure("investors")
    with _lock: payload = _snapshots.get("investors")
    data = {row["id"]: row for row in (payload or {}).get("items", [])}
    items = [_profile(data.get(profile["id"], {}), profile) for profile in source.INVESTORS]
    latest_report = max((row.get("report_date", "") for row in data.values() if row.get("data_basis") != "daily_fund"), default="")
    consensus_period = next((row.get("period") for row in data.values() if row.get("report_date") == latest_report), None)
    shared: dict[str, dict] = {}
    for profile in source.INVESTORS:
        disclosed = data.get(profile["id"], {})
        if disclosed.get("report_date") != latest_report or disclosed.get("data_basis") == "daily_fund":
            continue
        for row in disclosed.get("holdings", []):
            bucket = shared.setdefault(row["code"], {"code": row["code"], "name": row["name"], "investors": [], "max_weight": 0})
            bucket["investors"].append(profile["id"])
            bucket["max_weight"] = max(bucket["max_weight"], row["weight_pct"])
    consensus = sorted((dict(row, count=len(row["investors"])) for row in shared.values() if len(row["investors"]) >= 2), key=lambda row: (-row["count"], -row["max_weight"], row["code"]))[:12]
    return {"items": items, "consensus": consensus, "consensus_period": consensus_period, "edition": (payload or {}).get("edition"), "collected_at": (payload or {}).get("collected_at"),
            "available_count": sum(row["available"] for row in items), **_status("investors", payload)}


def get_portfolio(investor_id: str) -> dict | None:
    profile = next((row for row in source.INVESTORS if row["id"] == investor_id), None)
    if profile is None: return None
    ensure("investors")
    with _lock: payload = _snapshots.get("investors")
    data = next((row for row in (payload or {}).get("items", []) if row["id"] == investor_id), {})
    holdings = data.get("holdings", [])
    codes = [row["code"] for row in holdings]
    # Existing public quote recovery is shared across maps, investors and detail views.
    us_live_quotes.recover_missing(codes)
    quotes = us_live_quotes.latest(codes)
    enriched = []
    for row in holdings:
        quote = quotes.get(row["code"], {})
        price = quote.get("close") or row.get("snapshot_price")
        reference = row["reference_price"]
        enriched.append({**row, "current_price": price, "quote_time": quote.get("quote_time"),
                         "price_source": quote.get("quote_source") or "daily_snapshot", "session": quote.get("session"),
                         "reference_return_pct": round((price / reference - 1) * 100, 2) if price else None,
                         "current_value": price * row["shares"] if price else None})
    total = sum(row["current_value"] or 0 for row in enriched)
    complete = bool(enriched) and all(row["current_value"] is not None for row in enriched)
    # Daily funds can include private/no-ticker assets. A partial public-stock
    # subset must never be normalized to look like the entire fund.
    complete = complete and sum(row.get("weight_pct", 0) for row in enriched) >= 99
    for row in enriched:
        row["current_weight_pct"] = round(row["current_value"] / total * 100, 2) if complete and total else None
    return {"investor": _profile(data, profile), "holdings": enriched, "estimated_equity_value": total if complete else None, "valuation_complete": complete,
            "purchase_price_disclosed": False, "return_basis": "quarter_end_reference_excluding_dividends_and_subsequent_trades",
            "edition": data.get("edition", (payload or {}).get("edition")), "collected_at": data.get("collected_at"),
            **_status("investors", {**data, "edition": data.get("edition", (payload or {}).get("edition"))} if holdings else None)}


def start_scheduler() -> None:
    global _started
    with _lock:
        if _started: return
        _started = True
    _stop.clear()
    def loop():
        while not _stop.is_set():
            for kind in KINDS:
                try: ensure(kind)
                except Exception as exc: logger.info("Editorial scheduling failed: type=%s", type(exc).__name__)
            _stop.wait(30)
    threading.Thread(target=loop, name="editorial-08-kst", daemon=True).start()


def stop_scheduler() -> None:
    _stop.set()
