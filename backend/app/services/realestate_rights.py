"""MOLIT right transfers, kept separate from completed-apartment sales.

Fetch on demand in a single background worker. Persistent monthly snapshots
reuse the facts store under a separate namespace; a failed refresh never
overwrites good data. No prices are inferred from an apartment's name.
"""
from collections import OrderedDict, defaultdict
import datetime as dt
import hashlib
import math
import re
import threading
import time

from app.services import realestate_store as store

ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade"
MONTHS = 13
_lock = threading.Condition()
_cache = OrderedDict()
_queue = []
_busy = None
_started = False
_errors = {}
_blocked_until = 0.0


def _rm():
    from app.services import realestate_map
    return realestate_map


def fetch_month(lawd, month):
    rm = _rm()
    nodes, total = rm._get_page(ENDPOINT, lawd, month, 1)
    page = 1
    while page * rm.ROWS_PER_PAGE < total:
        page += 1
        more, _ = rm._get_page(ENDPOINT, lawd, month, page)
        nodes.extend(more)
        time.sleep(rm.CALL_SPACING_SECONDS)
    return parse_items(nodes, dt.datetime.now(rm.KST).date())


def parse_items(nodes, today):
    rm = _rm()
    out = []
    for node in nodes:
        if rm._text(node, "cdealType").upper() == "O" or rm._text(node, "cdealDay"):
            continue
        try:
            date = dt.date(*(rm._int(rm._text(node, k)) for k in ("dealYear", "dealMonth", "dealDay")))
            area = float(rm._text(node, "excluUseAr"))
            price = rm._int(rm._text(node, "dealAmount"))
        except (ValueError, TypeError):
            continue
        if date > today or not math.isfinite(area) or area <= 0 or price <= 0:
            continue
        name, dong = rm._text(node, "aptNm"), rm._dong_of(rm._text(node, "umdNm"))
        if not name or not dong:
            continue
        out.append([rm._as_int(date), "", name, dong, rm._text(node, "jibun"),
                    round(area, 2), price, rm._int(rm._text(node, "floor")), 0,
                    1 if "직거래" in rm._text(node, "dealingGbn") else 0,
                    rm._text(node, "ownershipGbn")])
    return out


def _load(lawd):
    with _lock:
        if lawd in _cache:
            _cache.move_to_end(lawd)
            return dict(_cache[lawd])
    loaded = store.load_facts(f"rights-v1:{lawd}")
    data = loaded[1] if loaded and isinstance(loaded[1], dict) else {}
    months = set(_rm()._months_back(MONTHS))
    data = {ym: row for ym, row in data.items() if ym in months}
    with _lock:
        _cache[lawd] = data
        while len(_cache) > 80:
            _cache.popitem(last=False)
    return dict(data)


def _missing(lawd, data):
    rm = _rm()
    months = rm._months_back(MONTHS)
    index = {(lawd, ym): row[0] for ym, row in data.items()}
    return [ym for ym in months if rm._needs_fetch(lawd, ym, index, months)]


def _request(lawd, data, priority=False):
    global _started
    if not _missing(lawd, data):
        return
    with _lock:
        if time.time() < _blocked_until or time.time() - _errors.get(lawd, (0, ""))[0] < 600:
            return
        if lawd != _busy:
            if lawd in _queue:
                if not priority:
                    return
                _queue.remove(lawd)
            _queue.insert(0 if priority else len(_queue), lawd)
        if not _started:
            _started = True
            threading.Thread(target=_worker, name="realestate-rights", daemon=True).start()
        _lock.notify()


def _worker():
    global _busy, _blocked_until
    rm = _rm()
    while True:
        with _lock:
            while not _queue:
                _lock.wait()
            lawd = _queue.pop(0)
            _busy = lawd
        try:
            store.migrated.wait()
            data = _load(lawd)
            for ym in _missing(lawd, data):
                if time.time() < _blocked_until:
                    break
                rows = fetch_month(lawd, ym)
                stamp = dt.datetime.now(rm.KST).isoformat(timespec="seconds")
                data[ym] = (stamp, rows)
                store.save_facts(f"rights-v1:{lawd}", data, stamp)
                with _lock:
                    _cache[lawd] = dict(data)
                    _errors.pop(lawd, None)
                rm._version += 1
                time.sleep(rm.CALL_SPACING_SECONDS)
        except Exception as exc:
            # Requests exceptions may embed the service key in their URL.
            message = str(exc) if isinstance(exc, rm.MolitError) else type(exc).__name__
            message = message.replace(rm._service_key() or "__no_key__", "[redacted]")
            with _lock:
                _errors[lawd] = (time.time(), message[:180])
                if any(k in message for k in ("budget", "KEY", "ACCESS", "DENIED")):
                    _blocked_until = time.time() + 3600
        finally:
            with _lock:
                _busy = None


def status(codes):
    with _lock:
        have = sum(len(_cache.get(code, {})) for code in codes)
        collecting = any(code in _queue or code == _busy for code in codes)
        failed = any(code in _errors for code in codes) or time.time() < _blocked_until
    return {"coverage": round(have / max(1, len(codes) * MONTHS), 3),
            "collecting": collecting, "error": "분양권 자료 연결을 확인 중입니다. 저장된 자료만 표시합니다." if failed else None}


def _name(value):
    return re.sub(r"[\W_]", "", value).casefold()


def merge_records(complexes, by_district, today):
    """Exact district+dong+normalized-name match only, never fuzzy address guesses.

    Keep each area type's sale and right histories separate; choose the freshest
    usable source by a fixed hierarchy. Original dictionaries are not mutated.
    """
    out = {cid: {**c, "types": dict(c["types"]), "type_sources": {t: "sale" for t in c["types"]}, "aliases": []}
           for cid, c in complexes.items()}
    names = defaultdict(list)
    for cid, c in out.items():
        names[c["lawd"], c["dong"], _name(c["name"])].append(cid)
    grouped = defaultdict(list)
    for lawd, rows in by_district.items():
        for r in rows:
            grouped[lawd, r[3], _name(r[2]), r[4]].append(r)
    right_types = defaultdict(lambda: defaultdict(list))
    for (lawd, dong, name, lot), rows in grouped.items():
        digest = hashlib.sha256(f"{dong}|{name}|{lot}".encode()).hexdigest()[:16]
        alias = f"{lawd}:rights:{digest}"
        matches = names.get((lawd, dong, name), [])
        cid = matches[0] if len(matches) == 1 else alias
        if cid not in out:
            out[cid] = {"id": cid, "name": rows[-1][2], "lawd": lawd, "dong": dong,
                        "built": 0, "last": 0, "types": {}, "type_sources": {}, "aliases": [],
                        "umd": dong, "jibun": lot}
        out[cid]["aliases"].append(alias)
        for r in rows:
            right_types[cid][round(r[5])].append((r[0], r[6], r[7], r[5], r[9]))
    end = _rm()._as_int(today)
    since = _rm()._as_int(today - dt.timedelta(days=365))
    recent = _rm()._as_int(today - dt.timedelta(days=183))
    def priority(rows, source):
        valid = [r for r in rows if since <= r[0] <= end]
        if not valid:
            return (0, 0, 0)
        fresh = [r for r in valid if r[0] >= recent]
        pool = fresh or valid
        # Recent brokers first, then recent direct, then older references.
        return (2 if fresh else 1, 2 if any(not r[4] for r in pool) else 1, 1 if source == "sale" else 0)
    for cid, types in right_types.items():
        c = out[cid]
        for area, rights in types.items():
            sales = c["types"].get(area, [])
            if not sales or priority(rights, "rights") > priority(sales, "sale"):
                c["types"][area] = rights
                c["type_sources"][area] = "rights"
        c["last"] = max((r[0] for rows in c["types"].values() for r in rows), default=0)
    return out


def merge(complexes, codes, priority=False):
    rm = _rm()
    # Unit tests and offline readers don't silently open a database or network.
    import os
    if not rm.is_configured() and os.getenv("RE_RIGHTS_READ_STORED") != "1":
        return complexes
    by_district = {}
    for lawd in codes:
        try:
            data = _load(lawd)
            by_district[lawd] = [r for _, rows in data.values() for r in rows]
            if rm.is_configured():
                _request(lawd, data, priority=priority)
        except Exception:
            with _lock:
                _errors[lawd] = (time.time(), "자료 저장소 연결 지연")
    return merge_records(complexes, by_district, dt.datetime.now(rm.KST).date())
