"""Chooses how the next Naver post is written, from how earlier posts did.

Each post is written in one of a few title shapes (A/B/C, see naver_social_content) and
one of two tag strategies (tight = 10 tags, wide = 15). Which combination brings more
readers to the site differs by edition, and it changes as the blog gains search trust,
so it is learned rather than fixed:

    reward(post) = site visits from the post's links (utm_campaign) in its first days
                   + 3 if Naver blog search showed the post in the top 10 for its title words

Arms with fewer than MIN_SAMPLES measured posts are tried first (in a fixed rotation),
then the best arm is used most of the time and another one EXPLORE of the time, so a
shape that starts working later is still noticed. The choice is seeded by the post key,
so rebuilding the same post gives the same variant.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
from collections import defaultdict

from app.services import naver_social_store
from app.services.naver_social_content import EDITIONS, TAG_ARMS, TITLE_ARMS

log = logging.getLogger(__name__)
MIN_SAMPLES = 2
EXPLORE = 0.25
WINDOW_DAYS = 28


def _roll(seed: str) -> float:
    return int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def reward(perf_rows: list[dict]) -> float:
    visits = max((r.get("visits") or 0) for r in perf_rows) if perf_rows else 0
    ranks = [r["search_rank"] for r in perf_rows if r.get("search_rank")]
    return visits + (3 if ranks and min(ranks) <= 10 else 0)


def arm_stats(kind: str | None = None) -> dict[str, dict]:
    """{variant: {"n", "mean", "best_title"}} for one kind of edition (or all)."""
    since = (dt.date.today() - dt.timedelta(days=WINDOW_DAYS)).isoformat()
    posts = naver_social_store.published_since(since)
    perf = defaultdict(list)
    for row in naver_social_store.perf_since(since):
        perf[row["post_key"]].append(row)
    out: dict[str, dict] = {}
    for post in posts:
        if kind and EDITIONS.get(post["edition"], (None,) * 5)[4] != kind:
            continue
        if post["post_key"] not in perf or not post.get("variant"):
            continue
        r = reward(perf[post["post_key"]])
        s = out.setdefault(post["variant"], {"n": 0, "total": 0.0, "best": (-1.0, "")})
        s["n"] += 1
        s["total"] += r
        if r > s["best"][0]:
            s["best"] = (r, post.get("title") or "")
    return {k: {"n": v["n"], "mean": round(v["total"] / v["n"], 2), "best_title": v["best"][1]} for k, v in out.items()}


def choose(day: dt.date, edition: str) -> str:
    kind = EDITIONS[edition][4]
    arms = [f"{t}-{g}" for t in TITLE_ARMS for g in TAG_ARMS]
    seed = f"{day}:{edition}"
    try:
        stats = arm_stats(kind)
    except Exception:
        log.exception("tuning stats unavailable; rotating variants")
        stats = {}
    fresh = [a for a in arms if stats.get(a, {}).get("n", 0) < MIN_SAMPLES]
    if fresh:
        # Rotate through untried arms by day so each edition kind covers them quickly.
        return fresh[(day.toordinal() + list(EDITIONS).index(edition)) % len(fresh)]
    ranked = sorted(arms, key=lambda a: stats[a]["mean"], reverse=True)
    if _roll(seed) < EXPLORE:
        return ranked[1 + int(_roll(seed + "x") * (len(ranked) - 1)) % (len(ranked) - 1)]
    return ranked[0]
