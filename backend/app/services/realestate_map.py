"""부동산 맵 — apartment heatmaps from 국토교통부 아파트 매매 실거래가 (data.go.kr).

Source
    국토교통부_아파트 매매 실거래가 자료 (RTMSDataSvcAptTrade), queried one
    시군구 (LAWD_CD, 5 digits) and one 계약년월 (DEAL_YMD) at a time. It needs a
    공공데이터포털 service key in MOLIT_API_KEY (DATA_GO_KR_API_KEY is accepted too).
    The 상세 variant (RTMSDataSvcAptTradeDev) returns the same fields and is tried
    when the key is only registered for that one.

What the map shows
    Tiles are 단지 (complexes). Each complex is priced by its 대표 평형 — the
    전용면적 it traded most in the last 12 months — and its 시세 is the latest
    contract price of that 평형. Tile area is that 시세; a group's area is the sum of
    its complexes', i.e. its share of the region's apartment value on the map.

    Colour is the change over the chosen period: the latest price of the 대표 평형
    against the last price it traded at before the period began. A complex with no
    trade of that 평형 inside the period has no change to show and is drawn as such,
    never as 0%. "오늘" means the most recent 계약일 in the data — contracts are
    reported up to 30 days late, so literally today is nearly always empty.

Collection
    Two years of months per 시군구 (a 1-year change needs a price from before the
    year began), stored in realestate_store so a restart or deploy never re-downloads
    them. A single background worker fetches: districts someone is looking at first,
    then 서울, 경기, 인천, then the rest. Recent months are re-fetched as late
    reports and cancellations (해제) arrive; old months rarely.
"""

from __future__ import annotations

import datetime as dt
import heapq
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

from app.services import realestate_store

load_dotenv()
log = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

TRADE_ENDPOINTS = (
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
)
REGION_ENDPOINT = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList"

REGIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "realestate_regions.json"

MONTHS_KEPT = 25  # this month plus the 24 before it: what the maps read
# A complex's card lists its trades back to here — the first month the 실거래가 API
# has. The months older than MONTHS_KEPT are collected only when the collector has
# nothing newer to do (districts whose cards were opened first), stay in the store,
# and are read for a card, never for a map.
HISTORY_FROM = os.environ.get("RE_HISTORY_FROM", "200601")
DEEP_CHUNK = 12  # older months fetched per turn, so newer work is never kept waiting
# Calls kept back each day for the recent months' refreshes.
DEEP_RESERVE = 1500
ROWS_PER_PAGE = 1000
# Development keys on data.go.kr allow 10,000 calls a day per API. Stop short of it so
# a busy day degrades into "collecting" rather than into an error for the rest of it.
DAILY_CALL_LIMIT = int(os.environ.get("MOLIT_DAILY_LIMIT", "9000"))
CALL_SPACING_SECONDS = 0.15

# A 동 shows up to 100 complexes, counting any that traded in the two years kept —
# which for most 동 is every one of them.
TOP_N: dict[str, int | None] = {"sido": 200, "sgg": 100, "dong": 100}
# A phone asks a 시·도 map for fewer complexes (its screen fits about 100 tiles); any
# other request size is clamped into this range.
SIDO_TOP_RANGE = (50, 500)
# Whatever the cut, every 시·군·구 on a 시·도 map keeps its own 10 priciest complexes,
# so a cheaper district never drops off the map because richer ones filled the top.
SGG_FLOOR = 10
# Months stored before the 거래구분 (중개/직거래) field was kept are re-read once.
REFETCH_STORED_BEFORE = dt.datetime(2026, 9, 24, 17, 37, tzinfo=ZoneInfo("Asia/Seoul"))
PERIODS = {"today": None, "7d": 7, "3m": 91, "6m": 182, "1y": 365}
WARM_ORDER = ("11", "41", "28")  # 서울, 경기, 인천 first; everything else after


def _service_key() -> str | None:
    key = (os.environ.get("MOLIT_API_KEY") or os.environ.get("DATA_GO_KR_API_KEY") or "").strip()
    if not key:
        return None
    # The portal hands out an "Encoding" and a "Decoding" key. requests encodes query
    # values itself, so an already-encoded key would be encoded twice and rejected.
    return urllib.parse.unquote(key) if "%" in key else key


def is_configured() -> bool:
    return _service_key() is not None


# ── regions ─────────────────────────────────────────────────────────────────


_regions_lock = threading.Lock()
_regions: dict | None = None


def _load_static_regions() -> dict:
    with open(REGIONS_PATH, encoding="utf-8") as f:
        return json.load(f)


def regions() -> dict:
    global _regions
    with _regions_lock:
        if _regions is None:
            _regions = _load_static_regions()
        return _regions


def _sgg_index() -> dict[str, dict]:
    out = {}
    for sido in regions()["sido"]:
        for sgg in sido["sgg"]:
            out[sgg["code"]] = {**sgg, "sido": sido["code"], "sido_name": sido["name"]}
    return out


def _refresh_regions_from_mois() -> bool:
    """Replaces the bundled 2024 code table with 행정안전부's live one, so districts
    created since (인천·화성의 새 구) appear. Best effort: on any failure the bundled
    table stays, which is still correct for every district that did not change."""
    key = _service_key()
    if not key:
        return False
    rows: list[dict] = []
    try:
        page = 1
        while True:
            res = requests.get(
                REGION_ENDPOINT,
                params={"serviceKey": key, "type": "json", "pageNo": page, "numOfRows": 1000},
                timeout=20,
            )
            res.raise_for_status()
            body = res.json()["StanReginCd"]
            head = body[0]["head"]
            total = int(next(h["totalCount"] for h in head if "totalCount" in h))
            batch = body[1]["row"]
            rows.extend(batch)
            if not batch or page * 1000 >= total:
                break
            page += 1
            time.sleep(CALL_SPACING_SECONDS)
    except Exception as exc:  # noqa: BLE001 — any shape surprise keeps the bundled table
        log.info("realestate: region refresh skipped (%s)", exc)
        return False

    sido_names: dict[str, str] = {}
    sgg: dict[str, tuple[str, str]] = {}
    dongs: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        code = str(r.get("region_cd", ""))
        if len(code) != 10 or str(r.get("ri_cd", "00")) != "00":
            continue
        name = str(r.get("locatadd_nm", "")).strip()
        sd, sg, umd = code[:2], code[2:5], code[5:8]
        if sg == "000" and umd == "000":
            sido_names[sd] = name
        elif umd == "000":
            sgg[code[:5]] = (sd, name)
        else:
            dongs[code[:5]].add(str(r.get("locallow_nm", "")).strip())
    if len(sido_names) < 15 or len(sgg) < 200:
        return False

    tree = []
    for sd, sd_name in sorted(sido_names.items()):
        kids = []
        for code, (s2, full) in sorted(sgg.items()):
            if s2 != sd:
                continue
            short = full[len(sd_name):].strip() or ("세종시" if sd == "36" else full)
            kids.append({"code": code, "name": short, "dongs": sorted(d for d in dongs.get(code, ()) if d)})
        # A city that is split into 구 has a code of its own that no trade is filed under.
        names = [k["name"] for k in kids]
        kids = [k for k in kids if not any(n.startswith(k["name"] + " ") for n in names)]
        if kids:
            tree.append({"code": sd, "name": sd_name, "sgg": kids})
    static_order = [s["code"] for s in _load_static_regions()["sido"]]
    tree.sort(key=lambda t: static_order.index(t["code"]) if t["code"] in static_order else 99)

    global _regions
    with _regions_lock:
        _regions = {"source": "행정안전부 법정동코드 (StanReginCd, 실시간)", "sido": tree}
    return True


# ── MOLIT client ────────────────────────────────────────────────────────────


class MolitError(RuntimeError):
    pass


_endpoint_choice: str | None = None
_last_error: str | None = None

# Calls made today, per API — 공공데이터포털 limits each API separately (매매, 전월세,
# K-apt). Counted in memory and saved every few calls, and read back after a restart:
# a count that started over at zero with each deploy let a busy day of deploys run
# past the portal's own limit, and every call after that came back
# LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR.
_calls_lock = threading.Lock()
_calls: dict[str, list] = {}  # api -> [day, count, count last saved]
SAVE_EVERY = 20
QUOTA_ERRORS = ("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS", "(22)")


def api_of(endpoint: str) -> str:
    if "AptRent" in endpoint:
        return "rent"
    if "AptList" in endpoint or "AptBasis" in endpoint:
        return "kapt"
    return "trade"


def _counter(api: str) -> list:
    today = dt.datetime.now(KST).strftime("%Y%m%d")
    c = _calls.get(api)
    if c is None or c[0] != today:
        try:
            saved = realestate_store.load_call_count(api, today)
        except Exception:  # noqa: BLE001 — count from here rather than stop
            saved = 0
        c = _calls[api] = [today, saved, saved]
    return c


def _save_count(api: str) -> None:
    with _calls_lock:
        day, count, _ = _calls[api]
    try:
        realestate_store.save_call_count(api, day, count)
        with _calls_lock:
            if _calls[api][0] == day:
                _calls[api][2] = count
    except Exception as exc:  # noqa: BLE001
        log.info("realestate: saving the %s call count failed (%s)", api, exc)


def _count_call(api: str = "trade") -> bool:
    with _calls_lock:
        c = _counter(api)
        if c[1] >= DAILY_CALL_LIMIT:
            return False
        c[1] += 1
        save = c[1] - c[2] >= SAVE_EVERY
    if save:
        _save_count(api)
    return True


def calls_today(api: str = "trade") -> int:
    with _calls_lock:
        return _counter(api)[1]


def exhaust(api: str) -> None:
    """The portal says today's limit is used up: no more calls to it until midnight."""
    with _calls_lock:
        c = _counter(api)
        already = c[1] >= DAILY_CALL_LIMIT
        c[1] = max(c[1], DAILY_CALL_LIMIT)
    if not already:
        log.warning("realestate: %s API daily limit reached at the portal; pausing it until midnight KST", api)
        _save_count(api)


def is_quota_error(text: str) -> bool:
    return any(k in text for k in QUOTA_ERRORS)


def _text(item: ET.Element, tag: str) -> str:
    el = item.find(tag)
    return (el.text or "").strip() if el is not None and el.text else ""


def _int(value: str) -> int:
    try:
        return int(float(value.replace(",", "").strip()))
    except (TypeError, ValueError):
        return 0


def _get_page(endpoint: str, lawd_cd: str, deal_ym: str, page: int) -> tuple[list[ET.Element], int]:
    api = api_of(endpoint)
    if not _count_call(api):
        raise MolitError("daily call budget exhausted")
    res = requests.get(
        endpoint,
        params={
            "serviceKey": _service_key(),
            "LAWD_CD": lawd_cd,
            "DEAL_YMD": deal_ym,
            "pageNo": page,
            "numOfRows": ROWS_PER_PAGE,
        },
        timeout=25,
    )
    try:
        root = ET.fromstring(res.content)
    except ET.ParseError as exc:
        res.raise_for_status()
        raise MolitError(f"응답을 해석할 수 없습니다: {res.text[:120]!r}") from exc
    # Gateway-level failures (bad key, unregistered key, quota) come back in their own
    # envelope rather than the service's header.
    reason = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    if root.tag == "OpenAPI_ServiceResponse" or reason:
        detail = root.findtext(".//errMsg") or reason or "OpenAPI error"
        message = f"{detail} ({root.findtext('.//returnReasonCode') or res.status_code})"
        if is_quota_error(message):
            exhaust(api)
            raise MolitError(f"daily call budget exhausted — {message}")
        raise MolitError(message)
    res.raise_for_status()
    code = (root.findtext(".//resultCode") or "").strip()
    if code == "03":  # NO_DATA — a month with no apartment sales in this district
        return [], 0
    if code not in ("", "00", "000"):
        raise MolitError(f"{code} {root.findtext('.//resultMsg') or ''}".strip())
    total = _int(root.findtext(".//totalCount") or "0")
    return root.findall(".//items/item"), total


def fetch_month(lawd_cd: str, deal_ym: str) -> list[list]:
    """One 시군구-month of apartment sales, cancelled contracts removed, as compact
    rows: [yyyymmdd, 단지일련번호, 단지명, 법정동, 지번, 전용면적, 거래금액(만원), 층, 건축년도,
    직거래 여부]."""
    global _endpoint_choice
    endpoints = [_endpoint_choice] if _endpoint_choice else list(TRADE_ENDPOINTS)
    last_exc: Exception | None = None
    for endpoint in endpoints:
        try:
            items, total = _get_page(endpoint, lawd_cd, deal_ym, 1)
            page = 1
            while page * ROWS_PER_PAGE < total:
                page += 1
                time.sleep(CALL_SPACING_SECONDS)
                more, _ = _get_page(endpoint, lawd_cd, deal_ym, page)
                items.extend(more)
            _endpoint_choice = endpoint
            break
        except MolitError as exc:
            last_exc = exc
            if "budget" in str(exc):
                raise
            continue
    else:
        raise last_exc or MolitError("no endpoint answered")

    out = []
    for it in items:
        if _text(it, "cdealType") in ("O", "o"):  # 해제된 계약
            continue
        year, month, day = _int(_text(it, "dealYear")), _int(_text(it, "dealMonth")), _int(_text(it, "dealDay"))
        price = _int(_text(it, "dealAmount"))
        try:
            area = round(float(_text(it, "excluUseAr") or 0), 2)
        except ValueError:
            area = 0.0
        if not (year and month and day and price and area):
            continue
        out.append(
            [
                year * 10000 + month * 100 + day,
                _text(it, "aptSeq"),
                _text(it, "aptNm"),
                _text(it, "umdNm"),
                _text(it, "jibun"),
                area,
                price,
                _int(_text(it, "floor")),
                _int(_text(it, "buildYear")),
                1 if "직거래" in _text(it, "dealingGbn") else 0,
            ]
        )
    return out


# ── month bookkeeping ───────────────────────────────────────────────────────


def _months_back(n: int, today: dt.date | None = None) -> list[str]:
    today = today or dt.datetime.now(KST).date()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _recent_since() -> str:
    """The oldest month the maps read."""
    return _months_back(MONTHS_KEPT)[-1]


def _deep_months() -> list[str]:
    """The months before the maps' window back to HISTORY_FROM, newest first."""
    out = []
    y, m = int(_recent_since()[:4]), int(_recent_since()[4:])
    while True:
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        ym = f"{y:04d}{m:02d}"
        if ym < HISTORY_FROM:
            return out
        out.append(ym)


def _stale_after(deal_ym: str, months: list[str]) -> dt.timedelta:
    """How long a stored month stays good. Contracts are reported up to 30 days after
    signing and cancellations later still, so the newest months are re-read often."""
    age = months.index(deal_ym) if deal_ym in months else len(months)
    if age <= 1:
        return dt.timedelta(hours=6)
    if age <= 3:
        return dt.timedelta(days=1)
    return dt.timedelta(days=30)


def _needs_fetch(lawd_cd: str, deal_ym: str, index: dict, months: list[str]) -> bool:
    fetched = index.get((lawd_cd, deal_ym))
    if not fetched:
        return True
    try:
        at = dt.datetime.fromisoformat(fetched)
    except ValueError:
        return True
    if at < REFETCH_STORED_BEFORE:
        return True
    return dt.datetime.now(KST) - at > _stale_after(deal_ym, months)


# ── district cache ──────────────────────────────────────────────────────────


_district_lock = threading.Lock()
_districts: OrderedDict[str, dict[str, list]] = OrderedDict()
MAX_DISTRICTS_IN_MEMORY = 90
_index: dict[tuple[str, str], str] = {}
_index_loaded = False
_version = 0  # bumped whenever stored data changes, to invalidate computed maps
# lawd_cd -> {deal_ym: deals} of the months before the maps' window, for cards.
_deep_cache: OrderedDict[str, dict[str, list]] = OrderedDict()
DEEP_CACHE_DISTRICTS = 12
DEEP_LOAD_YEARS = 3  # years of a district's history read per query
# Districts whose history loaded only in part, and when: read again after a while.
_deep_partial: dict[str, float] = {}
# Districts whose older months a reader is waiting on (a card was opened), newest first.
_deep_wanted: list[str] = []
_lawd_versions: dict[str, int] = {}  # the same, per district, for region summaries


def _ensure_index() -> None:
    global _index_loaded, _index
    if _index_loaded:
        return
    try:
        _index = realestate_store.fetched_index()
        _index_loaded = True
    except Exception as exc:  # noqa: BLE001
        log.warning("realestate: index load failed (%s)", exc)


def _district(lawd_cd: str) -> dict[str, list]:
    with _district_lock:
        if lawd_cd in _districts:
            _districts.move_to_end(lawd_cd)
            return _districts[lawd_cd]
    loaded = None
    for attempt in range(3):
        try:
            loaded = {ym: deals for ym, (_, deals) in realestate_store.load_district(lawd_cd, since=_recent_since()).items()}
            break
        except Exception as exc:  # noqa: BLE001
            log.warning("realestate: load %s failed (%s), attempt %d", lawd_cd, exc, attempt + 1)
            time.sleep(0.5 * (attempt + 1))
    if loaded is None:
        # Not cached: a failed read remembered as "no trades" left a fully collected
        # district empty on the map until the process restarted. The next request
        # tries the store again.
        return {}
    with _district_lock:
        _districts[lawd_cd] = loaded
        while len(_districts) > MAX_DISTRICTS_IN_MEMORY:
            _districts.popitem(last=False)
        return loaded


def _store_month(lawd_cd: str, deal_ym: str, deals: list) -> None:
    global _version
    now = dt.datetime.now(KST).isoformat(timespec="seconds")
    realestate_store.save_month(lawd_cd, deal_ym, deals, now)
    if deal_ym < _recent_since():
        # History for the cards: the maps neither hold nor read it. A district whose
        # history is in memory takes the new month as it is, instead of being read
        # again from the store after every month the backfill adds.
        with _district_lock:
            _index[(lawd_cd, deal_ym)] = now
            if lawd_cd in _deep_cache:
                _deep_cache[lawd_cd][deal_ym] = deals
        return
    with _district_lock:
        _index[(lawd_cd, deal_ym)] = now
        if lawd_cd in _districts:
            _districts[lawd_cd][deal_ym] = deals
        _version += 1
        _lawd_versions[lawd_cd] = _lawd_versions.get(lawd_cd, 0) + 1


# ── collector ───────────────────────────────────────────────────────────────


_queue_lock = threading.Condition()
# (priority, -batch, position, lawd_cd). Lower priority first; within a priority the
# most recent request first, so whoever is looking at the page *now* is served before
# a region someone opened a few minutes ago; within one request, in the order given.
_queue: list[tuple[int, int, int, str]] = []
_queued: dict[str, tuple[int, int]] = {}  # lawd_cd -> (priority, batch) of its live entry
_batch = 0
_in_flight: str | None = None
_worker_started = False


def request_districts(codes: list[str], priority: int = 0) -> None:
    """Asks the worker for these districts. Lower number = sooner; a page someone is
    looking at is 0. A newer request at the same priority goes ahead of older ones."""
    global _batch
    with _queue_lock:
        _batch += 1
        for position, code in enumerate(codes):
            if code == _in_flight:
                continue
            live = _queued.get(code)
            if live and live[0] < priority:
                continue  # already waiting at a more urgent priority
            _queued[code] = (priority, _batch)
            heapq.heappush(_queue, (priority, -_batch, position, code))
        _queue_lock.notify()


def _next_district(deep: bool = False) -> str | tuple[str, str]:
    """The next district to collect. With `deep`, an idle queue hands out a district
    whose older months are missing, as ("deep", code), instead of waiting."""
    global _in_flight
    with _queue_lock:
        while True:
            while not _queue:
                if deep:
                    code = _next_deep()
                    if code:
                        _in_flight = code
                        return ("deep", code)
                    _queue_lock.wait(timeout=60)
                    continue
                _queue_lock.wait()
            priority, neg_batch, _, code = heapq.heappop(_queue)
            if _queued.get(code) != (priority, -neg_batch):
                continue  # superseded by a newer entry for the same district
            del _queued[code]
            _in_flight = code
            return code


def _deep_missing(lawd_cd: str) -> list[str]:
    return [ym for ym in _deep_months() if (lawd_cd, ym) not in _index]


def want_history(lawd_cd: str) -> None:
    """A card of this district was opened: its older months go first."""
    with _queue_lock:
        if lawd_cd in _deep_wanted:
            _deep_wanted.remove(lawd_cd)
        _deep_wanted.insert(0, lawd_cd)
        del _deep_wanted[50:]
        _queue_lock.notify()


def _next_deep() -> str | None:
    """The district to fill older months for, when nothing newer is waiting: the ones
    readers opened, then every district in the warm order."""
    if calls_today("trade") > DAILY_CALL_LIMIT - DEEP_RESERVE:
        return None
    for code in list(_deep_wanted):
        if _deep_missing(code):
            return code
        _deep_wanted.remove(code)
    order = list(WARM_ORDER) + [s["code"] for s in regions()["sido"] if s["code"] not in WARM_ORDER]
    for sido_code in order:
        sido = next((s for s in regions()["sido"] if s["code"] == sido_code), None)
        for g in sido["sgg"] if sido else []:
            if _deep_missing(g["code"]):
                return g["code"]
    return None


def _collect_deep(lawd_cd: str) -> None:
    """Up to DEEP_CHUNK of a district's missing older months, newest first."""
    for deal_ym in _deep_missing(lawd_cd)[:DEEP_CHUNK]:
        if not _fetch_and_store(lawd_cd, deal_ym):
            return


def _collect_district(lawd_cd: str) -> None:
    months = _months_back(MONTHS_KEPT)
    for deal_ym in months:
        if not _needs_fetch(lawd_cd, deal_ym, _index, months):
            continue
        if not _fetch_and_store(lawd_cd, deal_ym):
            return


def _fetch_and_store(lawd_cd: str, deal_ym: str) -> bool:
    """One month from the API into the store; False when the collector should stop
    for now (an error or the day's budget)."""
    global _last_error
    try:
        deals = fetch_month(lawd_cd, deal_ym)
    except MolitError as exc:
        _last_error = str(exc)
        log.warning("realestate: %s %s — %s", lawd_cd, deal_ym, exc)
        if "budget" in str(exc):
            time.sleep(600)
        else:
            time.sleep(5)
        return False
    except Exception as exc:  # noqa: BLE001 — network trouble; try again later
        _last_error = str(exc)
        log.warning("realestate: %s %s — %s", lawd_cd, deal_ym, exc)
        time.sleep(5)
        return False
    _last_error = None
    try:
        _store_month(lawd_cd, deal_ym, deals)
    except Exception as exc:  # noqa: BLE001
        log.warning("realestate: store %s %s failed (%s)", lawd_cd, deal_ym, exc)
        return False
    time.sleep(CALL_SPACING_SECONDS)
    return True


def _warm_all() -> None:
    order = list(WARM_ORDER) + [s["code"] for s in regions()["sido"] if s["code"] not in WARM_ORDER]
    for rank, sido_code in enumerate(order):
        sido = next((s for s in regions()["sido"] if s["code"] == sido_code), None)
        if sido:
            request_districts([g["code"] for g in sido["sgg"]], priority=10 + rank)


def after_migration() -> None:
    """Forgets everything read while the 부동산 data was still being copied to its own
    database: the index, the districts, the maps and the region summaries."""
    global _index_loaded
    from app.services import realestate_rent, realestate_summary

    with _district_lock:
        _index_loaded = False
        _index.clear()
        _districts.clear()
        _deep_cache.clear()
    with _map_cache_lock:
        _map_cache.clear()
    realestate_summary._cache.clear()
    realestate_rent._cache.clear()


def _worker() -> None:
    global _in_flight
    _refresh_regions_from_mois()
    if not realestate_store.migrated.is_set():
        realestate_store.migrated.wait()
        after_migration()
    _ensure_index()
    last_warm = 0.0
    while True:
        if time.time() - last_warm > 3 * 3600:
            _warm_all()
            last_warm = time.time()
        task = _next_district(deep=True)
        try:
            if isinstance(task, tuple):
                _collect_deep(task[1])
            else:
                _collect_district(task)
        finally:
            with _queue_lock:
                _in_flight = None


def start_collector() -> None:
    global _worker_started
    if _worker_started or not is_configured():
        return
    _worker_started = True
    threading.Thread(target=_worker, name="realestate-collector", daemon=True).start()


# ── brands ──────────────────────────────────────────────────────────────────

# Checked in order, so a premium line is caught before the plain brand it contains
# ("아크로" before a later "e편한세상", "디에이치" before "현대").
BRANDS: list[tuple[str, tuple[str, ...]]] = [
    ("acro", ("아크로",)),
    ("dh", ("디에이치",)),
    ("lerl", ("르엘",)),
    ("ohtier", ("오티에르",)),
    ("raemian", ("래미안",)),
    ("xi", ("자이", "XI")),
    ("hillstate", ("힐스테이트", "HILLSTATE")),
    ("prugio", ("푸르지오", "PRUGIO")),
    ("ipark", ("아이파크", "IPARK", "I-PARK", "아이-파크")),
    ("eplus", ("E편한세상", "E-편한세상", "이편한세상")),
    ("lottecastle", ("롯데캐슬",)),
    ("thesharp", ("더샵",)),
    ("skview", ("SK뷰", "에스케이뷰", "SKVIEW", "SK VIEW")),
    ("hoban", ("호반써밋", "호반베르디움", "호반")),
    ("centreville", ("센트레빌",)),
    ("sujain", ("수자인",)),
    ("woomi", ("우미린",)),
    ("desian", ("데시앙",)),
    ("starhills", ("스타힐스",)),
    ("hanwha", ("꿈에그린", "포레나")),
    ("switzen", ("스위첸",)),
    ("haneulchae", ("하늘채",)),
    ("wive", ("위브",)),
    ("haeringon", ("해링턴",)),
    ("sclass", ("S-클래스", "에스클래스", "S클래스")),
    ("yuboura", ("유보라",)),
    ("richeville", ("리슈빌",)),
    ("poongkyungchae", ("풍경채",)),
    ("humansia", ("휴먼시아",)),
    ("hyundai", ("현대",)),
]


def brand_of(name: str) -> str | None:
    upper = name.upper()  # needles are upper-case; Hangul is unaffected
    for key, needles in BRANDS:
        if any(n in upper for n in needles):
            return key
    return None


# ── the map ─────────────────────────────────────────────────────────────────


def _ymd(n: int) -> dt.date:
    return dt.date(n // 10000, (n // 100) % 100, n % 100)


def _as_int(d: dt.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _dong_of(umd: str) -> str:
    return umd.split()[0] if umd else ""


def _complexes(lawd_codes: list[str], months: dict[str, list] | None = None) -> dict[str, dict]:
    """Every complex in these districts, with its trades grouped by 평형. `months`
    reads one district from an already loaded copy instead of the cache."""
    out: dict[str, dict] = {}
    for lawd in lawd_codes:
        # A snapshot: the collector may add a month to this dict while we read it.
        for deals in list((months if months is not None else _district(lawd)).values()):
            for row in deals:
                day, seq, name, umd, jibun, area, price, floor, built = row[:9]
                direct = row[9] if len(row) > 9 else 0
                key = f"{lawd}:{seq}" if seq else f"{lawd}:{umd}:{jibun}:{name}"
                c = out.get(key)
                if c is None:
                    c = out[key] = {
                        "id": key,
                        "name": name,
                        "lawd": lawd,
                        "dong": _dong_of(umd),
                        "built": built,
                        "last": 0,
                        "types": defaultdict(list),
                    }
                if day >= c["last"]:
                    c["last"], c["name"], c["dong"] = day, name or c["name"], _dong_of(umd) or c["dong"]
                c["types"][round(area)].append((day, price, floor, area, direct))
    return out


def _mean_on(trades: list[tuple], day: int) -> float:
    prices = [p for d, p, *_ in trades if d == day]
    return sum(prices) / len(prices)


ROBUST_TRADES = 3
ROBUST_SPAN_DAYS = 90


def _robust_price(trades: list[tuple], until: int) -> tuple[float, int] | None:
    """The price of a 평형 as of `until`: the median of its last few trades on or
    before that day, taken from the 90 days before the latest of them.

    One trade is a poor price — a 4th-floor unit and a 24th-floor one in the same
    complex can sit 15% apart in the same week — and comparing one trade with one
    trade made a quiet complex read +35% on a floor difference. Returns (price, day of
    the latest trade used), or None when nothing traded by `until`."""
    upto = [x for x in trades if x[0] <= until]
    if not upto:
        return None
    last = upto[-1][0]
    floor_day = _as_int(_ymd(last) - dt.timedelta(days=ROBUST_SPAN_DAYS))
    picked = sorted(p for d, p, *_ in upto[-ROBUST_TRADES:] if d >= floor_day)
    mid = len(picked) // 2
    median = picked[mid] if len(picked) % 2 else (picked[mid - 1] + picked[mid]) / 2
    return median, last


HISTORY_POINTS = 40
OTHER_TYPES = 4


def _trade(x: tuple) -> dict:
    return {"date": _ymd(x[0]).isoformat(), "price": x[1], "floor": x[2], "direct": bool(x[4])}


def _type_view(rows: list[tuple], window_start: int, year_ago: int) -> dict:
    """One 평형 of a complex as the map and its popup show it: its price now and
    before the period, the change between them, its trades (every one, 직거래
    marked, for the chart and the recent list) and its range over the past year.

    직거래 (unbrokered, often between relatives) is priced off-market often enough
    that one of them as the reference swings a complex by 30%, so brokered trades
    set the price whenever the 평형 has any."""
    every = sorted(rows)
    trades = [x for x in every if not x[4]] or every
    last_day = trades[-1][0]
    price, _ = _robust_price(trades, last_day)
    in_window = [x for x in trades if x[0] >= window_start] if window_start else []
    change = base = base_day = None
    if in_window:
        before = _robust_price(trades, window_start - 1) if any(x[0] < window_start for x in trades) else None
        if before:
            base, base_day = before
        else:
            # Nothing before the period: compare with its own first trade day, if the
            # period holds more than one.
            window_days = sorted({x[0] for x in in_window})
            if len(window_days) > 1:
                base_day = window_days[0]
                base = _mean_on(trades, base_day)
        if base:
            change = (price - base) / base * 100
    on_last = [x for x in trades if x[0] == last_day]
    area = sum(x[3] for x in on_last) / len(on_last)
    year = [x for x in trades if x[0] >= year_ago]
    high = max(year, key=lambda x: (x[1], x[0])) if year else None
    low = min(year, key=lambda x: (x[1], -x[0])) if year else None
    return {
        "price": round(price),
        "area": round(area, 2),
        "pyeong": round(area / 3.3058, 1),
        "deal_date": _ymd(last_day).isoformat(),
        "floor": on_last[-1][2],
        "base_price": round(base) if base else None,
        "base_date": _ymd(base_day).isoformat() if base_day else None,
        "change_pct": round(change, 2) if change is not None else None,
        "trades": len(in_window),
        "history": [[x[0], x[1], x[2], x[4]] for x in every[-HISTORY_POINTS:]],
        "high_1y": _trade(high) if high else None,
        "low_1y": _trade(low) if low else None,
    }


def _detail(c: dict, rep: int, year_ago: int) -> dict:
    """What the popup shows about the complex as a whole: how busy it is and what its
    other 평형 last sold for."""
    others = []
    for area_key, rows in c["types"].items():
        if area_key == rep:
            continue
        rows = sorted(rows)
        pool = [x for x in rows if not x[4]] or rows
        last = pool[-1]
        others.append(
            {
                "area": round(sum(x[3] for x in rows) / len(rows), 2),
                "price": last[1],
                "date": _ymd(last[0]).isoformat(),
                "trades_1y": sum(1 for x in rows if x[0] >= year_ago),
            }
        )
    others.sort(key=lambda o: (o["trades_1y"], o["date"]), reverse=True)
    return {
        "trades_1y": sum(1 for rows in c["types"].values() for x in rows if x[0] >= year_ago),
        "types": others[:OTHER_TYPES],
    }


def _sido_top(top: int | None) -> int:
    if top is None:
        return TOP_N["sido"]
    lo, hi = SIDO_TOP_RANGE
    return max(lo, min(hi, top))


def _with_floor(rows: list[dict], limit: int) -> list[dict]:
    """The `limit` priciest rows, plus each 시·군·구's own priciest SGG_FLOOR that the
    cut left out. Rows arrive sorted by price and leave in that order."""
    per_sgg: dict[str, int] = {}
    kept = []
    for i, r in enumerate(rows):
        n = per_sgg.get(r["sgg"], 0)
        if i < limit or n < SGG_FLOOR:
            kept.append(r)
            per_sgg[r["sgg"]] = n + 1
    return kept


def _lawd_codes(sido: str | None, sgg: str | None) -> list[str]:
    if sgg:
        if sgg not in _sgg_index():
            raise ValueError("unknown 시군구")
        return [sgg]
    region = next((s for s in regions()["sido"] if s["code"] == sido), None)
    if region is None:
        raise ValueError("unknown 시도")
    return [g["code"] for g in region["sgg"]]


def _status(lawd_codes: list[str]) -> dict:
    """How much of these districts is collected — live, even on a cached map."""
    configured = is_configured()
    months = _months_back(MONTHS_KEPT)
    have = sum(1 for code in lawd_codes for ym in months if (code, ym) in _index)
    coverage = have / (len(lawd_codes) * len(months))
    return {
        "configured": configured,
        "coverage": round(coverage, 3),
        "collecting": configured and coverage < 1,
        "error": _last_error,
        "calls_today": calls_today("trade"),
    }


def _prefetch(lawd_codes: list[str]) -> None:
    """Loads the districts not yet in memory in one query. Read one at a time, a
    시·도 of 40-odd districts spent over half a minute on round trips to the store
    before a single complex was priced."""
    with _district_lock:
        missing = [c for c in lawd_codes if c not in _districts]
    if not missing:
        return
    try:
        loaded = realestate_store.load_districts(missing, since=_recent_since())
    except Exception as exc:  # noqa: BLE001 — _district retries one by one
        log.warning("realestate: batch load of %d districts failed (%s)", len(missing), exc)
        return
    with _district_lock:
        for code, months in loaded.items():
            _districts[code] = {ym: deals for ym, (_, deals) in months.items()}
            _districts.move_to_end(code)
        # Never evict the districts this map is about to read.
        keep = set(lawd_codes)
        while len(_districts) > max(MAX_DISTRICTS_IN_MEMORY, len(keep)):
            oldest = next((c for c in _districts if c not in keep), None)
            if oldest is None:
                break
            _districts.pop(oldest)


def build_map(sido: str | None, sgg: str | None, dong: str | None, period: str, top: int | None = None) -> dict:
    if period not in PERIODS:
        raise ValueError("unknown period")
    index = _sgg_index()
    lawd_codes = _lawd_codes(sido, sgg)
    level = ("dong" if dong else "sgg") if sgg else "sido"

    if is_configured():
        start_collector()
        _ensure_index()
        request_districts(lawd_codes, priority=0)

    _prefetch(lawd_codes)
    complexes = _complexes(lawd_codes)
    if dong:
        complexes = {k: c for k, c in complexes.items() if c["dong"] == dong}

    today = dt.datetime.now(KST).date()
    year_ago = _as_int(today - dt.timedelta(days=365))
    latest_day = max((c["last"] for c in complexes.values()), default=0)
    days = PERIODS[period]
    if days is None:
        window_start = latest_day
    else:
        window_start = _as_int(today - dt.timedelta(days=days))

    rows = []
    for c in complexes.values():
        recent = {t: [x for x in trades if x[0] >= year_ago] for t, trades in c["types"].items()}
        recent = {t: v for t, v in recent.items() if v}
        if not recent and level == "dong":
            recent = {t: v for t, v in c["types"].items() if v}
        if not recent:
            continue
        rep = max(recent, key=lambda t: (len(recent[t]), t))
        rows.append(
            {
                "id": c["id"],
                "name": c["name"],
                "brand": brand_of(c["name"]),
                "sgg": index[c["lawd"]]["name"],
                "dong": c["dong"],
                "built": c["built"] or None,
                "trades_all": sum(1 for t in c["types"].values() for x in t if window_start and x[0] >= window_start),
                **_type_view(c["types"][rep], window_start, year_ago),
                **_detail(c, rep, year_ago),
            }
        )

    rows.sort(key=lambda r: r["price"], reverse=True)
    top_n = _sido_top(top) if level == "sido" else TOP_N[level]
    if level == "sido":
        rows = _with_floor(rows, top_n)
    elif top_n:
        rows = rows[:top_n]
    for r in rows:
        r["group"] = r["sgg"] if level == "sido" else (r["dong"] or dong or "기타")

    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "level": level,
        "period": period,
        "top_n": top_n,
        "group_floor": SGG_FLOOR if level == "sido" else None,
        "latest_deal_date": _ymd(latest_day).isoformat() if latest_day else None,
        "window_start": _ymd(window_start).isoformat() if window_start else None,
        "status": _status(lawd_codes),
        "count": len(rows),
        "items": rows,
    }



def _window(period: str, latest_day: int) -> tuple[int, int]:
    today = dt.datetime.now(KST).date()
    days = PERIODS[period]
    start = latest_day if days is None else _as_int(today - dt.timedelta(days=days))
    return start, _as_int(today - dt.timedelta(days=365))


def complex_detail(complex_id: str, period: str) -> dict:
    """Every 평형 of one complex, each laid out the way the map lays out its 대표 평형
    — what the popup's 평형 selector switches between. The id is the map item's."""
    if period not in PERIODS:
        raise ValueError("unknown period")
    lawd = complex_id.split(":", 1)[0]
    index = _sgg_index()
    if lawd not in index:
        raise ValueError("unknown 시군구")
    c = _complexes([lawd]).get(complex_id)
    if c is None:
        raise LookupError("no such complex")
    window_start, year_ago = _window(period, c["last"])
    # Period windows are the same ones the map used: its "오늘" is the region's latest
    # contract day, which a single complex does not know, so it falls back to its own.
    older = _older_trades(lawd, complex_id)
    views = []
    for key, rows in c["types"].items():
        view = _type_view(rows, window_start, year_ago)
        view["key"] = key
        view["trades_1y"] = sum(1 for x in rows if x[0] >= year_ago)
        view["trades_total"] = len(rows)
        # Every trade of this 평형 we hold, newest first: [day, price, floor, 직거래].
        every = sorted(rows + older.get(key, []), reverse=True)
        view["deals"] = [[x[0], x[1], x[2], x[4]] for x in every]
        views.append(view)
    views.sort(key=lambda v: (v["trades_1y"], v["trades_total"], v["key"]), reverse=True)
    deep = _deep_months()
    have = [ym for ym in deep if (lawd, ym) in _index]
    earliest = min(have) if have else _recent_since()
    if len(have) < len(deep):
        want_history(lawd)
    return {
        "id": c["id"],
        "name": c["name"],
        "period": period,
        "types": views,
        "history": {
            # The oldest month collected for this district, and whether every month
            # back to HISTORY_FROM is in.
            "from": f"{earliest[:4]}-{earliest[4:]}",
            "target": f"{HISTORY_FROM[:4]}-{HISTORY_FROM[4:]}",
            "complete": len(have) == len(deep),
        },
    }


def _older_trades(lawd: str, complex_id: str) -> dict[int, list[tuple]]:
    """This complex's trades from before the maps' window, by 평형, as _complexes
    groups them. Read from the store once per district while its history grows."""
    with _district_lock:
        months = _deep_cache.get(lawd)
        if months is not None:
            _deep_cache.move_to_end(lawd)
    stale_partial = lawd in _deep_partial and time.time() - _deep_partial[lawd] > 20
    if months is None or stale_partial:
        loaded: dict[str, list] = {}
        complete = True
        # A few years per query: twenty years of a busy district at once outran the
        # store client's read timeout. A query that fails is tried again; what did
        # load is kept, and the rest is read again on a later card.
        edge = _recent_since()
        while edge > HISTORY_FROM:
            start = f"{int(edge[:4]) - DEEP_LOAD_YEARS:04d}{edge[4:]}"
            chunk = None
            for attempt in range(3):
                try:
                    chunk = realestate_store.load_district(lawd, since=max(start, HISTORY_FROM), before=edge)
                    break
                except Exception as exc:  # noqa: BLE001
                    log.warning("realestate: history of %s before %s (try %d): %s", lawd, edge, attempt + 1, exc)
                    time.sleep(0.4 * (attempt + 1))
            if chunk is None:
                complete = False
            else:
                loaded.update({ym: deals for ym, (_, deals) in chunk.items()})
            edge = start
        with _district_lock:
            # Months the backfill stored meanwhile are kept too.
            months = {**loaded, **_deep_cache.get(lawd, {})}
            _deep_cache[lawd] = months
            _deep_cache.move_to_end(lawd)
            while len(_deep_cache) > DEEP_CACHE_DISTRICTS:
                _deep_cache.popitem(last=False)
            if complete:
                _deep_partial.pop(lawd, None)
            else:
                _deep_partial[lawd] = time.time()
    out: dict[int, list[tuple]] = defaultdict(list)
    for deals in months.values():
        for row in deals:
            day, seq, name, umd, jibun, area, price, floor, built = row[:9]
            direct = row[9] if len(row) > 9 else 0
            key = f"{lawd}:{seq}" if seq else f"{lawd}:{umd}:{jibun}:{name}"
            if key == complex_id:
                out[round(area)].append((day, price, floor, area, direct))
    return out

_map_cache_lock = threading.Lock()
# key -> (built at, data version, the response as JSON without its "status")
_map_cache: OrderedDict[tuple, tuple[float, int, str]] = OrderedDict()
MAP_CACHE_SECONDS = 120
# A 시·도 map is answered from the last one built — in memory, else as stored — and
# rebuilt behind the reader once it is this old. Building one means reading every
# district of the 시·도, which is seconds for the largest even in one query.
SIDO_MAP_REFRESH_SECONDS = 15 * 60
# Every 시·도 × period × screen size is kept built this fresh by a background pass.
SIDO_MAP_WARM_SECONDS = 60 * 60
WARM_PERIODS = ("3m", "6m", "1y")
WARM_TOPS = (200, 100)

_rebuild_lock = threading.Condition()
_rebuild_queue: list[tuple] = []
_rebuild_started = False


def _store_key(key: tuple) -> str:
    sido, _, _, period, top = key
    return f"sido:{sido}:{period}:{top}"


def _body(result: dict) -> str:
    """The map as JSON, its live "status" left out to be added when served. Kept as
    text: the country's 시·도 maps as Python objects would take hundreds of MB, and
    re-encoding a 900-complex map on every request cost more than reading it."""
    return json.dumps({k: v for k, v in result.items() if k != "status"}, ensure_ascii=False, separators=(",", ":"))


def _remember(key: tuple, body: str, built: float, persist: bool) -> None:
    persist = persist and realestate_store.migrated.is_set()
    with _map_cache_lock:
        _map_cache[key] = (built, _version, body)
        _map_cache.move_to_end(key)
        while len(_map_cache) > 400:
            _map_cache.popitem(last=False)
    if persist:
        try:
            stamp = dt.datetime.fromtimestamp(built, KST).isoformat(timespec="seconds")
            realestate_store.save_map(_store_key(key), body, stamp)
        except Exception as exc:  # noqa: BLE001 — the memory copy still serves
            log.warning("realestate: saving map %s failed (%s)", key, exc)


def _build_and_remember(key: tuple, persist: bool) -> str:
    sido, sgg, dong, period, top = key
    body = _body(build_map(sido, sgg, dong, period, top))
    _remember(key, body, time.time(), persist)
    return body


def _rebuild_worker() -> None:
    while True:
        with _rebuild_lock:
            while not _rebuild_queue:
                _rebuild_lock.wait()
            key = _rebuild_queue.pop(0)
        try:
            _build_and_remember(key, persist=True)
        except Exception as exc:  # noqa: BLE001
            log.warning("realestate: rebuilding map %s failed (%s)", key, exc)
        time.sleep(0.05)


def _schedule_rebuild(key: tuple, first: bool = False) -> None:
    """Queues a 시·도 map for the background builder; `first` for one a reader is
    waiting on, ahead of the warm pass."""
    global _rebuild_started
    with _rebuild_lock:
        if not _rebuild_started:
            threading.Thread(target=_rebuild_worker, name="realestate-maps", daemon=True).start()
            _rebuild_started = True
        if key in _rebuild_queue:
            if not first:
                return
            _rebuild_queue.remove(key)
        if first:
            _rebuild_queue.insert(0, key)
        else:
            _rebuild_queue.append(key)
        _rebuild_lock.notify()


def _cached(key: tuple) -> tuple[float, str] | None:
    """A 시·도 map from memory, else from the store (and then kept in memory)."""
    with _map_cache_lock:
        hit = _map_cache.get(key)
    if hit:
        return hit[0], hit[2]
    try:
        row = realestate_store.load_map(_store_key(key))
    except Exception as exc:  # noqa: BLE001
        log.warning("realestate: reading stored map %s failed (%s)", key, exc)
        return None
    if row is None:
        return None
    try:
        built = dt.datetime.fromisoformat(row[0]).timestamp()
    except ValueError:
        built = 0.0
    _remember(key, row[1], built, persist=False)
    return built, row[1]


def warm_sido_maps() -> None:
    """Queues every 시·도 map not built within the hour, 서울·경기·인천 first and each
    시·도's variants together, so its districts are read once for all of them."""
    order = list(WARM_ORDER) + [s["code"] for s in regions()["sido"] if s["code"] not in WARM_ORDER]
    for sido in order:
        for period in WARM_PERIODS:
            for top in WARM_TOPS:
                key = (sido, None, None, period, top)
                hit = _cached(key)
                if hit is None or time.time() - hit[0] > SIDO_MAP_WARM_SECONDS:
                    _schedule_rebuild(key)


def start_map_warmer() -> None:
    """Keeps the 시·도 maps built: a pass now, then every half hour."""

    def loop() -> None:
        realestate_store.migrated.wait()  # no maps from a half-copied database
        while True:
            try:
                warm_sido_maps()
            except Exception as exc:  # noqa: BLE001
                log.warning("realestate: map warm pass failed (%s)", exc)
            time.sleep(SIDO_MAP_WARM_SECONDS / 2)

    threading.Thread(target=loop, name="realestate-map-warmer", daemon=True).start()


def _served(body: str, lawd_codes: list[str]) -> str:
    """A remembered map with its collection status read now."""
    status = json.dumps(_status(lawd_codes), ensure_ascii=False, separators=(",", ":"))
    return f'{body[:-1]},"status":{status}}}'


def get_map(sido: str | None, sgg: str | None, dong: str | None, period: str, top: int | None = None) -> str:
    """build_map as JSON text, remembered. A 시·군·구 or 동 map is rebuilt once its
    data changes or two minutes pass — a fraction of a second. A 시·도 map is
    answered at once from the last one built and rebuilt in the background when it
    is stale; only a 시·도 never built before is built while the reader waits."""
    if period not in PERIODS:
        raise ValueError("unknown period")
    top = _sido_top(top) if not sgg else None
    key = (sido, sgg, dong, period, top)
    lawd_codes = _lawd_codes(sido, sgg)
    if not sgg:
        if is_configured():
            start_collector()
            _ensure_index()
            request_districts(lawd_codes, priority=0)
        hit = _cached(key)
        if hit is not None:
            if time.time() - hit[0] > SIDO_MAP_REFRESH_SECONDS:
                _schedule_rebuild(key, first=True)
            return _served(hit[1], lawd_codes)
        return _served(_build_and_remember(key, persist=True), lawd_codes)
    with _map_cache_lock:
        hit = _map_cache.get(key)
    if hit and hit[1] == _version and time.time() - hit[0] < MAP_CACHE_SECONDS:
        return _served(hit[2], lawd_codes)
    return _served(_build_and_remember(key, persist=False), lawd_codes)
