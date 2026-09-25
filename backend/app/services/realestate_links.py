"""The search words that open a complex on 네이버 부동산, for the card's listing link.

The trade data names a complex the way its 실거래 reports do — "신도6", "개포우성2",
"상록마을(우성)1" — and 네이버 부동산's search finds some of those and not others
("신도6" finds nothing; "신도6차" opens the complex). So the words are tried: the
name with 차 after a closing number, as written, with and without a parenthesised
word, without the closing number — each with its 동 in front — and the first that
네이버 resolves to a single complex is kept. Failing that, one that lands on the map
around it. The answer is stored, so a complex costs a handful of lookups once, on
the first card opened for it.

Only the redirect of 네이버's public search page is read, as the reader's browser
would follow it; nothing of the page itself is taken.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import urllib.parse

import requests

from app.services import realestate_map as rm
from app.services import realestate_store

log = logging.getLogger(__name__)

SEARCH = "https://m.land.naver.com/search/result/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
MAX_TRIES = 8
FRESH = dt.timedelta(days=90)


def candidates(name: str, dong: str) -> list[str]:
    # "(10,11,20동)" lists buildings and "(1009-4)" is a lot number: neither is a name.
    base = re.sub(r"\([^)]*동\)|\([\d\s,~\-]+\)", "", name)
    names = []
    for n in (re.sub(r"[()]", "", base), re.sub(r"\(.*?\)", "", base)):
        n = re.sub(r"\s+", "", n).strip()
        if n and n not in names:
            names.append(n)
    out: list[str] = []

    def add(words: str) -> None:
        words = f"{dong} {words}".strip()
        if words not in out:
            out.append(words)

    for n in names:
        if re.search(r"\d$", n):
            add(f"{n}차")  # 실거래 writes 차수 without 차: "신도6" is 신도6차
        add(n)
    for n in names:
        bare = re.sub(r"\d+(차|단지)?$", "", n)
        if bare and bare != n:
            add(bare)
    return out[:MAX_TRIES]


_last_status = ""


def _resolve(words: str) -> tuple[str, str | None]:
    """("complex", number) | ("map", None) | ("none", None) for one search."""
    global _last_status
    try:
        res = requests.get(SEARCH + urllib.parse.quote(words), headers={"User-Agent": UA}, allow_redirects=False, timeout=6)
    except requests.RequestException as exc:
        _last_status = f"error {type(exc).__name__}"
        return "error", None
    loc = res.headers.get("Location", "")
    _last_status = f"{res.status_code} {loc[:60]}"
    if res.status_code in (301, 302, 303, 307, 308):
        if "/complex/info/" in loc:
            return "complex", loc.split("/complex/info/")[1].split("?")[0]
        if "/map/" in loc:
            return "map", None
    return "none", None


def naver_link(complex_id: str) -> dict:
    """{"query": words, "kind": "complex" | "map" | "search"} for a map complex."""
    key = f"naver:{complex_id}"
    try:
        stored = realestate_store.load_facts(key)
    except Exception:  # noqa: BLE001
        stored = None
    if stored:
        at, payload = stored
        try:
            # Only an answer that found something is kept; an old "search" is not.
            if payload.get("kind") != "search" and dt.datetime.now(rm.KST) - dt.datetime.fromisoformat(at) < FRESH:
                return payload
        except ValueError:
            pass

    lawd = complex_id.split(":", 1)[0]
    if lawd not in rm._sgg_index():
        raise ValueError("unknown 시군구")
    c = rm._complexes([lawd]).get(complex_id)
    if c is None:
        raise LookupError("no such complex")
    words = candidates(c["name"], c["dong"])
    found: dict | None = None
    near: str | None = None
    for w in words:
        kind, number = _resolve(w)
        if kind == "complex":
            found = {"query": w, "kind": "complex", "complex": number}
            break
        if kind == "map" and near is None:
            near = w
    if found is None:
        found = {"query": near, "kind": "map"} if near else {"query": words[0], "kind": "search", "last": _last_status}
    # "Nothing found" may be 네이버 not answering this server the way it answers a
    # reader; only a found complex or map is worth keeping.
    if found["kind"] != "search":
        try:
            realestate_store.save_facts(key, found, dt.datetime.now(rm.KST).isoformat(timespec="seconds"))
        except Exception as exc:  # noqa: BLE001
            log.info("realestate links: store %s failed (%s)", key, exc)
    return found
