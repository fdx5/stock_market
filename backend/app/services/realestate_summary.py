"""How each region moved — the colours of the 부동산 맵's 3D region map.

A region's move is the price-weighted mean of its complexes' moves over the period,
the same figure the treemap prints beside a group's name: each complex priced by its
대표 평형 exactly as build_map prices it, weighted by that price, over the complexes
that traded inside the period.

A district's summary (the district as a whole and each of its 읍·면·동) is computed
once a day and again whenever its trades change. A 시·도 map needs every district in
the country, more than the district cache holds, so a background thread summarises
those, reading each district straight from the store so the districts people are
looking at stay cached. The response says how many are still pending, and the page
asks again.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import time
from collections import deque

from app.services import realestate_map as rm
from app.services import realestate_store

log = logging.getLogger(__name__)

_lock = threading.Condition()
# (lawd, period) -> (district version, day computed, summary)
_cache: dict[tuple[str, str], tuple[int, int, dict]] = {}
_pending: deque[tuple[str, str]] = deque()
_pending_set: set[tuple[str, str]] = set()
_worker_started = False


def _empty() -> dict:
    return {"n": 0, "moved": 0, "up": 0, "down": 0, "w": 0.0, "wc": 0.0}


def _add(agg: dict, price: float, change: float | None) -> None:
    agg["n"] += 1
    if change is None:
        return
    agg["moved"] += 1
    agg["up"] += change > 0
    agg["down"] += change < 0
    agg["w"] += price
    agg["wc"] += price * change


def summarise(lawd: str, period: str, months: dict[str, list] | None = None) -> dict:
    """One district: {"all": agg, "dongs": {name: agg}}, each agg a running sum."""
    complexes = rm._complexes([lawd], months)
    today = dt.datetime.now(rm.KST).date()
    year_ago = rm._as_int(today - dt.timedelta(days=365))
    days = rm.PERIODS[period]
    latest_day = max((c["last"] for c in complexes.values()), default=0)
    window_start = latest_day if days is None else rm._as_int(today - dt.timedelta(days=days))
    whole, dongs = _empty(), {}
    for c in complexes.values():
        # The same 대표 평형 build_map picks: the one traded most in the past year.
        recent = {t: [x for x in trades if x[0] >= year_ago] for t, trades in c["types"].items()}
        recent = {t: v for t, v in recent.items() if v}
        if not recent:
            continue
        rep = max(recent, key=lambda t: (len(recent[t]), t))
        view = rm._type_view(c["types"][rep], window_start, year_ago)
        _add(whole, view["price"], view["change_pct"])
        _add(dongs.setdefault(c["dong"] or "기타", _empty()), view["price"], view["change_pct"])
    return {"all": whole, "dongs": dongs}


def _today() -> int:
    return rm._as_int(dt.datetime.now(rm.KST).date())


def _fresh(lawd: str, period: str) -> dict | None:
    hit = _cache.get((lawd, period))
    if hit and hit[0] == rm._lawd_versions.get(lawd, 0) and hit[1] == _today():
        return hit[2]
    return None


def _store(lawd: str, period: str, version: int, summary: dict) -> None:
    with _lock:
        _cache[(lawd, period)] = (version, _today(), summary)


def _worker() -> None:
    while True:
        with _lock:
            while not _pending:
                _lock.wait()
            key = _pending.popleft()
            _pending_set.discard(key)
        lawd, period = key
        if _fresh(lawd, period) is not None:
            continue
        version = rm._lawd_versions.get(lawd, 0)
        try:
            with rm._district_lock:
                months = rm._districts.get(lawd)
            if months is None:
                months = {ym: deals for ym, (_, deals) in realestate_store.load_district(lawd).items()}
            _store(lawd, period, version, summarise(lawd, period, months))
        except Exception as exc:  # noqa: BLE001
            log.warning("realestate summary %s %s failed: %s", lawd, period, exc)
        # A country-wide pass is a few hundred districts of pure Python; a breath
        # between them keeps the request threads answering meanwhile.
        time.sleep(0.03)


def _request(keys: list[tuple[str, str]], first: bool = False) -> None:
    """Queues districts for the worker; `first` puts them ahead of the rest (a 시·도
    someone opened comes before the country-wide pass)."""
    global _worker_started
    with _lock:
        if not _worker_started:
            threading.Thread(target=_worker, name="realestate-summary", daemon=True).start()
            _worker_started = True
        for key in reversed(keys) if first else keys:
            if key in _pending_set:
                if first:
                    _pending.remove(key)
                    _pending.appendleft(key)
                continue
            _pending_set.add(key)
            if first:
                _pending.appendleft(key)
            else:
                _pending.append(key)
        _lock.notify()


def _merge(aggs: list[dict]) -> dict:
    out = _empty()
    for a in aggs:
        for k in out:
            out[k] += a[k]
    return out


def _out(code: str, name: str, agg: dict) -> dict:
    return {
        "code": code,
        "name": name,
        "change": round(agg["wc"] / agg["w"], 2) if agg["w"] else None,
        "complexes": agg["n"],
        "moved": agg["moved"],
        "up": agg["up"],
        "down": agg["down"],
    }


def region_summary(level: str, period: str, sido: str | None = None, sgg: str | None = None) -> dict:
    """Every region of one level with its move: all 시·도, one 시·도's 시·군·구, or
    one 시·군·구's 읍·면·동."""
    if period not in rm.PERIODS:
        raise ValueError("unknown period")
    all_sido = rm.regions()["sido"]
    if level == "dong":
        if not sgg or sgg not in rm._sgg_index():
            raise ValueError("unknown 시군구")
        summary = _fresh(sgg, period)
        if summary is None:
            version = rm._lawd_versions.get(sgg, 0)
            summary = summarise(sgg, period)
            _store(sgg, period, version, summary)
        items = [_out(name, name, agg) for name, agg in summary["dongs"].items()]
        return {"level": level, "period": period, "pending": 0, "items": items}

    if level == "sgg":
        region = next((s for s in all_sido if s["code"] == sido), None)
        if region is None:
            raise ValueError("unknown 시도")
        groups = [(g["code"], g["name"], [g["code"]]) for g in region["sgg"]]
    elif level == "sido":
        groups = [(s["code"], s["name"], [g["code"] for g in s["sgg"]]) for s in all_sido]
    else:
        raise ValueError("unknown level")

    missing = [(code, period) for _, _, codes in groups for code in codes if _fresh(code, period) is None]
    if missing:
        _request(missing, first=level == "sgg")
    items = []
    for code, name, codes in groups:
        ready = [s for c in codes if (s := _fresh(c, period)) is not None]
        entry = _out(code, name, _merge([s["all"] for s in ready]))
        entry["ready"] = round(len(ready) / len(codes), 3) if codes else 1.0
        items.append(entry)
    return {"level": level, "period": period, "pending": len(missing), "items": items}
