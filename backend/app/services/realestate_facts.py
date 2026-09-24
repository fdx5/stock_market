"""세대수 and 주차대수 for the 부동산 맵's complex card, from 공동주택관리정보 (K-apt).

Source
    국토교통부_공동주택 단지 목록제공 서비스 (AptListService4) lists a 시군구's 단지 with
    their K-apt code; 국토교통부_공동주택 기본 정보제공 서비스 (AptBasisInfoServiceV5)
    gives one 단지's 세대수 (getAphusBassInfoV5) and 지상·지하 주차대수
    (getAphusDtlInfoV5). Both take the same data.go.kr key as the trade API, once the
    key is registered for them.

Matching
    The trade data and K-apt share no id, so a map complex is matched to a K-apt 단지
    by name inside its 시군구, preferring its own 법정동. K-apt covers the complexes
    under mandatory management (roughly 150세대 and up); a small one simply has no
    card figures.

Everything fetched is stored (realestate_store.re_complex_facts), so a 단지 costs at
most two calls a quarter and a 시군구 list a few a month.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import threading
import time
import xml.etree.ElementTree as ET

import requests

from app.services import realestate_map as rm
from app.services import realestate_store

log = logging.getLogger(__name__)

LIST_ENDPOINT = "https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4"
BASIS_ENDPOINT = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5"
LIST_ROWS = 1000
LIST_FRESH = dt.timedelta(days=30)
INFO_FRESH = dt.timedelta(days=90)
FAILURE_RETRY_SECONDS = 600

_lock = threading.Lock()
_memo: dict[str, tuple[float, object]] = {}
_failures: dict[str, tuple[float, str]] = {}
_last_raw = ""  # the latest response's head, quoted when a list comes back empty


class FactsError(RuntimeError):
    pass


def _items(res: requests.Response) -> tuple[list[dict], int]:
    """The items and totalCount of a data.go.kr response, JSON or XML alike."""
    text = res.text.strip()
    if text.startswith("{"):
        payload = res.json()
        gateway = payload.get("OpenAPI_ServiceResponse")
        if isinstance(gateway, dict):  # key or service refused before reaching the API
            head = gateway.get("cmmMsgHeader") or {}
            raise FactsError(f"{head.get('errMsg') or 'OpenAPI error'} ({head.get('returnReasonCode') or res.status_code})")
        # Most services wrap header and body in "response"; some answer them bare.
        envelope = payload.get("response") if isinstance(payload.get("response"), dict) else payload
        header = envelope.get("header") or {}
        code = str(header.get("resultCode") or "00")
        if code not in ("00", "000"):
            raise FactsError(f"{code} {header.get('resultMsg') or ''}".strip())
        body = envelope.get("body") or {}
        if not body and "items" not in envelope:
            raise FactsError(f"알 수 없는 응답: {text[:160]!r}")
        items = body.get("items")
        if isinstance(items, dict):
            items = items.get("item")
        if items is None:
            items = body.get("item")
        if isinstance(items, dict):
            items = [items]
        return list(items or []), int(body.get("totalCount") or len(items or []))
    try:
        root = ET.fromstring(res.content)
    except ET.ParseError as exc:
        res.raise_for_status()
        raise FactsError(f"응답을 해석할 수 없습니다: {text[:120]!r}") from exc
    reason = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    if root.tag == "OpenAPI_ServiceResponse" or reason:
        raise FactsError(f"{root.findtext('.//errMsg') or reason} ({root.findtext('.//returnReasonCode') or res.status_code})")
    code = (root.findtext(".//resultCode") or "00").strip()
    if code not in ("00", "000", "03"):
        raise FactsError(f"{code} {root.findtext('.//resultMsg') or ''}".strip())
    nodes = root.findall(".//items/item") or root.findall(".//body/item")
    items = [{child.tag: (child.text or "").strip() for child in node} for node in nodes]
    return items, int(root.findtext(".//totalCount") or len(items))


def _get(url: str, params: dict) -> tuple[list[dict], int]:
    key = rm._service_key()
    if not key:
        raise FactsError("MOLIT_API_KEY 미설정")
    if not rm._count_call():
        raise FactsError("daily call budget exhausted")
    global _last_raw
    res = requests.get(url, params={"serviceKey": key, "_type": "json", **params}, timeout=20)
    _last_raw = res.text[:200]
    return _items(res)


def _stored(key: str, fresh: dt.timedelta, fetch):
    """A lookup from memory, then the store, then the API — failures remembered for
    ten minutes so a key without this API does not spend a call per card."""
    now = time.time()
    with _lock:
        if key in _memo and now - _memo[key][0] < fresh.total_seconds():
            return _memo[key][1]
        failed = _failures.get(key)
        if failed and now - failed[0] < FAILURE_RETRY_SECONDS:
            raise FactsError(failed[1])
    row = realestate_store.load_facts(key)
    if row and not row[1]:  # an empty 단지 list stored before those were refused
        row = None
    if row:
        fetched_at, payload = row
        try:
            age = dt.datetime.now(rm.KST) - dt.datetime.fromisoformat(fetched_at)
        except ValueError:
            age = fresh
        if age < fresh:
            with _lock:
                _memo[key] = (now - age.total_seconds(), payload)
            return payload
    try:
        payload = fetch()
    except (FactsError, requests.RequestException, ValueError) as exc:
        if row:  # stale beats nothing
            return row[1]
        with _lock:
            _failures[key] = (now, str(exc))
        raise FactsError(str(exc)) from exc
    realestate_store.save_facts(key, payload, dt.datetime.now(rm.KST).isoformat(timespec="seconds"))
    with _lock:
        _memo[key] = (now, payload)
        _failures.pop(key, None)
    return payload


def _sgg_list(lawd: str) -> list[dict]:
    def fetch():
        out, page = [], 1
        while True:
            items, total = _get(LIST_ENDPOINT, {"sigunguCode": lawd, "numOfRows": LIST_ROWS, "pageNo": page})
            out.extend(
                {
                    "code": str(it.get("kaptCode") or ""),
                    "name": str(it.get("kaptName") or ""),
                    "dong": str(it.get("as3") or ""),
                    "ri": str(it.get("as4") or ""),
                }
                for it in items
                if it.get("kaptCode")
            )
            if not items or page * LIST_ROWS >= total:
                break
            page += 1
        if not out:  # never store "this 시군구 has no 단지" — it is an API hiccup
            raise FactsError(f"단지 목록이 비어 있습니다: {_last_raw!r}")
        return out

    return _stored(f"list:{lawd}", LIST_FRESH, fetch)


def _num(value) -> int | None:
    try:
        n = int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _info(kapt_code: str) -> dict:
    def fetch():
        basic, _ = _get(f"{BASIS_ENDPOINT}/getAphusBassInfoV5", {"kaptCode": kapt_code})
        detail, _ = _get(f"{BASIS_ENDPOINT}/getAphusDtlInfoV5", {"kaptCode": kapt_code})
        b = basic[0] if basic else {}
        d = detail[0] if detail else {}
        return {
            "households": _num(b.get("kaptdaCnt")),
            "parking_ground": _num(d.get("kaptdPcnt")),
            "parking_under": _num(d.get("kaptdPcntu")),
        }

    return _stored(f"kapt:{kapt_code}", INFO_FRESH, fetch)


_NOISE = re.compile(r"\(.*?\)|\[.*?\]|아파트|apt|[\s\-_.,·&']")


def _norm(name: str) -> str:
    return _NOISE.sub("", name.lower())


def match(name: str, dong: str, candidates: list[dict]) -> dict | None:
    """The K-apt 단지 a trade-data complex is, by name — exact first, then one name
    inside the other — among its own 동's 단지 before the whole 시군구's. Ambiguous
    containment (two 단지 fit equally) matches nothing rather than the wrong one."""
    target = _norm(name)
    if not target:
        return None
    local = [c for c in candidates if dong and dong in (c["dong"], c["ri"])]
    for pool in (local, candidates):
        exact = [c for c in pool if _norm(c["name"]) == target]
        if len(exact) == 1:
            return exact[0]
        if exact:
            return None
        partial = [c for c in pool if (n := _norm(c["name"])) and len(n) >= 2 and (n in target or target in n)]
        if partial:
            partial.sort(key=lambda c: abs(len(_norm(c["name"])) - len(target)))
            best = abs(len(_norm(partial[0]["name"])) - len(target))
            if len(partial) == 1 or abs(len(_norm(partial[1]["name"])) - len(target)) > best:
                return partial[0]
            return None
    return None


def complex_facts(complex_id: str) -> dict:
    """세대수 and 주차 of one map complex (the map item's id). `matched` is false when
    K-apt has no 단지 by that name in its 시군구; `error` says why nothing was read."""
    lawd = complex_id.split(":", 1)[0]
    if lawd not in rm._sgg_index():
        raise ValueError("unknown 시군구")
    c = rm._complexes([lawd]).get(complex_id)
    if c is None:
        raise LookupError("no such complex")
    out = {"id": complex_id, "matched": False, "households": None, "parking": None, "parking_per_household": None}
    try:
        listed = _sgg_list(lawd)
        found = match(c["name"], c["dong"], listed)
        if found is None:
            return {**out, "listed": len(listed)}
        info = _info(found["code"])
    except FactsError as exc:
        log.info("realestate facts %s: %s", complex_id, exc)
        return {**out, "error": str(exc)}
    parts = [p for p in (info.get("parking_ground"), info.get("parking_under")) if p is not None]
    parking = sum(parts) if parts else None
    households = info.get("households") or None
    return {
        **out,
        "matched": True,
        "kapt_name": found["name"],
        "households": households,
        "parking": parking,
        "parking_ground": info.get("parking_ground"),
        "parking_under": info.get("parking_under"),
        "parking_per_household": round(parking / households, 1) if parking is not None and households else None,
    }
