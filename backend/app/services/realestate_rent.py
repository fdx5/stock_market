"""전세·월세 for the 부동산 맵's complex card, from 국토교통부 아파트 전월세 실거래가.

Source
    국토교통부_아파트 전월세 실거래가 자료 (RTMSDataSvcAptRent): one 시군구 and one
    계약년월 at a time, like the sales, with the same data.go.kr key once the key is
    registered for it.

Collection
    Only for districts a reader opens a card's 전세/월세 view in — the maps never use
    leases — two years back, into realestate_store.re_rent_months, by a worker of its
    own so a reader waiting on leases is not queued behind the sales backfill. Recent
    months are re-read as late reports arrive, on the sales' schedule.

Matching
    A lease names the 단지 by 단지일련번호 when the API gives one, else by 법정동 and
    지번 (or name) — matched against the sales rows the card's complex was built from.
"""

from __future__ import annotations

import datetime as dt
import logging
import statistics
import threading
import time
from collections import OrderedDict, defaultdict

from app.services import realestate_map as rm
from app.services import realestate_store

log = logging.getLogger(__name__)

RENT_ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
RENT_MONTHS = 25
CACHE_DISTRICTS = 16
KIND = {"신규": 1, "갱신": 2}

_lock = threading.Condition()
# lawd_cd -> {deal_ym: (fetched_at, deals)}
_cache: OrderedDict[str, dict[str, tuple[str, list]]] = OrderedDict()
_wanted: list[str] = []
_busy: str | None = None
_worker_started = False
_error: str | None = None
_error_at = 0.0


def fetch_rent_month(lawd_cd: str, deal_ym: str) -> list[list]:
    """One 시군구-month of leases, cancelled ones removed, as compact rows: [yyyymmdd,
    단지일련번호, 단지명, 법정동, 지번, 전용면적, 보증금(만원), 월세(만원), 층, 계약구분
    (1 신규, 2 갱신, 0 모름), 종전 보증금, 종전 월세]."""
    items, total = rm._get_page(RENT_ENDPOINT, lawd_cd, deal_ym, 1)
    page = 1
    while page * rm.ROWS_PER_PAGE < total:
        page += 1
        time.sleep(rm.CALL_SPACING_SECONDS)
        more, _ = rm._get_page(RENT_ENDPOINT, lawd_cd, deal_ym, page)
        items.extend(more)
    out = []
    for it in items:
        if rm._text(it, "cdealType") in ("O", "o"):
            continue
        year, month, day = rm._int(rm._text(it, "dealYear")), rm._int(rm._text(it, "dealMonth")), rm._int(rm._text(it, "dealDay"))
        try:
            area = round(float(rm._text(it, "excluUseAr") or 0), 2)
        except ValueError:
            area = 0.0
        deposit = rm._int(rm._text(it, "deposit"))
        if not (year and month and day and area and deposit):
            continue
        out.append(
            [
                year * 10000 + month * 100 + day,
                rm._text(it, "aptSeq"),
                rm._text(it, "aptNm"),
                rm._text(it, "umdNm"),
                rm._text(it, "jibun"),
                area,
                deposit,
                rm._int(rm._text(it, "monthlyRent")),
                rm._int(rm._text(it, "floor")),
                KIND.get(rm._text(it, "contractType"), 0),
                rm._int(rm._text(it, "preDeposit")),
                rm._int(rm._text(it, "preMonthlyRent")),
            ]
        )
    return out


def _months() -> list[str]:
    return rm._months_back(RENT_MONTHS)


def _district(lawd_cd: str) -> dict[str, tuple[str, list]]:
    with _lock:
        hit = _cache.get(lawd_cd)
        if hit is not None:
            _cache.move_to_end(lawd_cd)
            return hit
    loaded = realestate_store.load_rent_district(lawd_cd, since=_months()[-1])
    with _lock:
        _cache[lawd_cd] = loaded
        while len(_cache) > CACHE_DISTRICTS:
            _cache.popitem(last=False)
        return loaded


def _missing(lawd_cd: str) -> list[str]:
    months = _months()
    have = _district(lawd_cd)
    index = {(lawd_cd, ym): at for ym, (at, _) in have.items()}
    return [ym for ym in months if rm._needs_fetch(lawd_cd, ym, index, months)]


def _worker() -> None:
    global _busy, _error, _error_at
    while True:
        with _lock:
            while not _wanted:
                _lock.wait()
            code = _wanted[0]
            _busy = code
        try:
            for ym in _missing(code):
                if _error and time.time() - _error_at < 600:
                    break
                try:
                    deals = fetch_rent_month(code, ym)
                except rm.MolitError as exc:
                    _error, _error_at = str(exc), time.time()
                    log.warning("realestate rent: %s %s — %s", code, ym, exc)
                    break
                except Exception as exc:  # noqa: BLE001
                    _error, _error_at = str(exc), time.time()
                    log.warning("realestate rent: %s %s — %s", code, ym, exc)
                    break
                _error = None
                now = dt.datetime.now(rm.KST).isoformat(timespec="seconds")
                realestate_store.save_rent_month(code, ym, deals, now)
                with _lock:
                    if code in _cache:
                        _cache[code][ym] = (now, deals)
                time.sleep(rm.CALL_SPACING_SECONDS)
        finally:
            with _lock:
                if _wanted and _wanted[0] == code:
                    _wanted.pop(0)
                _busy = None
        if _error:
            time.sleep(30)


def _request(lawd_cd: str) -> None:
    global _worker_started
    with _lock:
        if not _worker_started:
            threading.Thread(target=_worker, name="realestate-rent", daemon=True).start()
            _worker_started = True
        if lawd_cd != _busy:
            if lawd_cd in _wanted:
                _wanted.remove(lawd_cd)
            _wanted.insert(0 if _busy is None else min(1, len(_wanted)), lawd_cd)
        _lock.notify()


def _robust(rows: list[tuple]) -> tuple[float, int] | None:
    """The last few leases' median, as the sales are priced (rm._robust_price)."""
    if not rows:
        return None
    last = rows[-1][0]
    floor_day = rm._as_int(rm._ymd(last) - dt.timedelta(days=rm.ROBUST_SPAN_DAYS))
    picked = [r[1] for r in rows[-rm.ROBUST_TRADES :] if r[0] >= floor_day]
    return statistics.median(picked), last


def _identity(lawd: str, complex_id: str) -> tuple[str, set[tuple[str, str]], set[str], str] | None:
    """(단지일련번호, {(법정동, 지번)}, {단지명}, 동) of a map complex, from its sales."""
    seq = complex_id.split(":", 1)[1] if complex_id.count(":") == 1 else ""
    places, names, dong = set(), set(), ""
    for deals in rm._district(lawd).values():
        for row in deals:
            day, s, name, umd, jibun = row[:5]
            key = f"{lawd}:{s}" if s else f"{lawd}:{umd}:{jibun}:{name}"
            if key == complex_id:
                places.add((umd, jibun))
                names.add(name)
                dong = rm._dong_of(umd)
    if not places:
        return None
    return seq, places, names, dong


def complex_rent(complex_id: str) -> dict:
    """The complex's leases by 평형: 전세 and 월세 prices now, their past year, and
    every lease held, for the card's 전세/월세 views."""
    lawd = complex_id.split(":", 1)[0]
    if lawd not in rm._sgg_index():
        raise ValueError("unknown 시군구")
    who = _identity(lawd, complex_id)
    if who is None:
        raise LookupError("no such complex")
    seq, places, names, dong = who
    configured = rm.is_configured()
    missing = _missing(lawd) if configured else []
    if missing:
        _request(lawd)
    months = _months()
    coverage = 1 - len(missing) / len(months)

    year_ago = rm._as_int(dt.datetime.now(rm.KST).date() - dt.timedelta(days=365))
    by_type: dict[int, list[list]] = defaultdict(list)
    for _, deals in _district(lawd).values():
        for row in deals:
            r_seq, r_name, r_umd, r_jibun = row[1], row[2], row[3], row[4]
            same = (seq and r_seq == seq) or (r_umd, r_jibun) in places or (r_name in names and rm._dong_of(r_umd) == dong)
            if same:
                by_type[round(row[5])].append(row)

    types = []
    for key, rows in by_type.items():
        rows.sort(key=lambda r: r[0])
        jeonse = [(r[0], r[6], r[8]) for r in rows if r[7] == 0]
        wolse = [r for r in rows if r[7] > 0]
        j_now = _robust(jeonse)
        j_year = [x for x in jeonse if x[0] >= year_ago]
        w_last = wolse[-1] if wolse else None
        types.append(
            {
                "key": key,
                "area": round(sum(r[5] for r in rows) / len(rows), 2),
                "jeonse": {
                    "price": round(j_now[0]) if j_now else None,
                    "date": rm._ymd(j_now[1]).isoformat() if j_now else None,
                    "trades_1y": len(j_year),
                    "high_1y": max((x[1] for x in j_year), default=None),
                    "low_1y": min((x[1] for x in j_year), default=None),
                },
                "wolse": {
                    "deposit": w_last[6] if w_last else None,
                    "rent": w_last[7] if w_last else None,
                    "date": rm._ymd(w_last[0]).isoformat() if w_last else None,
                    "trades_1y": sum(1 for r in wolse if r[0] >= year_ago),
                },
                # [yyyymmdd, 보증금, 월세, 층, 계약구분, 종전 보증금, 종전 월세], newest first
                "deals": [[r[0], r[6], r[7], r[8], r[9], r[10], r[11]] for r in reversed(rows)],
            }
        )
    types.sort(key=lambda t: len(t["deals"]), reverse=True)
    error = _error if _error and time.time() - _error_at < 600 else None
    return {
        "id": complex_id,
        "types": types,
        "status": {
            "configured": configured,
            "coverage": round(coverage, 3),
            "collecting": configured and bool(missing) and not error,
            "error": error,
            "from": f"{months[-1][:4]}-{months[-1][4:]}",
        },
    }
