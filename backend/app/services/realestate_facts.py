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
    _last_raw = res.text[:400]
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
        if not any(c["name"] for c in out):
            raise FactsError(f"단지 이름 필드가 없습니다: {_last_raw!r}")
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
            # 세대수; a few 단지 leave it blank and fill 호수 (ho) instead.
            "households": _num(b.get("kaptdaCnt")) or _num(b.get("hoCnt")),
            "parking_ground": _num(d.get("kaptdPcnt")),
            "parking_under": _num(d.get("kaptdPcntu")),
        }

    return _stored(f"kapt2:{kapt_code}", INFO_FRESH, fetch)  # kapt2: read with the 호수 fallback


# Spellings the trade data and K-apt write differently, folded to one.
_ALIASES = (
    ("이편한세상", "e편한세상"),
    ("e-편한세상", "e편한세상"),
    ("i-park", "아이파크"),
    ("ipark", "아이파크"),
)
_ROMAN = str.maketrans({"Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3", "Ⅳ": "4", "Ⅴ": "5", "Ⅵ": "6", "Ⅶ": "7", "Ⅷ": "8", "Ⅸ": "9"})
# Words one side adds and the other leaves out: builder brands of public housing,
# "아파트" itself, and the 차/단지 after a number.
_FILLER = re.compile(r"\d+(?:차|단지)?|아파트|apt|주공|휴먼시아|lh|[\s\-_.,·&'~()\[\]]")


def _parts(name: str, dong: str = "") -> tuple[str, frozenset[str]]:
    """A name as (its letters without numbers or filler, its numbers). Parentheses
    listing 동 numbers are dropped; any other parenthesised word — 아름마을(효성),
    공덕자이(임대) — is part of the name. The 동's own name (대흥동태영) is dropped."""
    s = name.translate(_ROMAN).lower()
    if dong and len(dong) > 1:
        s = s.replace(dong, "")
    for a, b in _ALIASES:
        s = s.replace(a, b)
    s = re.sub(r"\([^)]*동\)", "", s)
    s = re.sub(r"제(?=\d)", "", s)
    numbers = frozenset(n.lstrip("0") or "0" for n in re.findall(r"\d+", s))
    return _FILLER.sub("", s), numbers


def _lcs(a: str, b: str) -> int:
    prev = [0] * (len(b) + 1)
    for ch in a:
        cur = [0]
        for j, bj in enumerate(b):
            cur.append(prev[j] + 1 if ch == bj else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def _score(target: tuple[str, frozenset[str]], candidate: dict, dong: str = "") -> tuple | None:
    """How well a K-apt 단지 fits a trade-data name, or None when it cannot be it.

    Numbers decide: 한양4 is never 한양3단지, though 장미2 may be 장미1차2차. Letters
    are compared in order, so K-apt's added place names (정자상록마을우성 for
    상록마을(우성)) cost nothing, but the candidate must end where the name does —
    타워팰리스3 is not 타워팰리스G동."""
    core, nums = target
    c_core, c_nums = _parts(candidate["name"], dong)
    if not c_core or not c_core.endswith(core[-1]):
        return None
    if nums and c_nums and not nums <= c_nums:
        return None
    ratio = _lcs(core, c_core) / len(core)
    number_fit = 1 if nums and c_nums else 0 if not nums and not c_nums else -1
    return ratio, number_fit, -abs(len(c_core) - len(core))


def match(name: str, dong: str, candidates: list[dict]) -> dict | None:
    """The K-apt 단지 a trade-data complex is: the best fit among its own 동's 단지,
    else an all-but-exact one elsewhere in the 시군구. Two equally good fits match
    nothing — no figures beat another 단지's."""
    # The name as written, then without its parenthesised words: 백현마을8단지(대림)
    # is K-apt's 판교백현마을8단지, where 아름마을(효성) needs its 효성.
    variants = [v for v in {_parts(name, dong), _parts(re.sub(r"\(.*?\)", "", name), dong)} if len(v[0]) >= 2]
    if not variants:
        return None
    local = [c for c in candidates if dong and dong in (c["dong"], c["ri"])]
    for pool, floor in ((local, 0.8), (candidates, 1.0)):
        scored = []
        for c in pool:
            fits = [sc for v in variants if (sc := _score(v, c, dong))]
            if fits and max(fits)[0] >= floor:
                scored.append((max(fits), c))
        scored.sort(key=lambda x: x[0], reverse=True)
        if scored:
            if len(scored) > 1 and scored[1][0] == scored[0][0]:
                return None
            return scored[0][1]
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
            nearby = [x["name"] for x in listed if c["dong"] and c["dong"] in (x["dong"], x["ri"])]
            return {**out, "listed": len(listed), "nearby": nearby[:40]}
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
