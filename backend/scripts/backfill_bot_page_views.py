"""Reclassifies the pre-instrumentation page_views rows as bot or human.

From now on `is_bot` is decided from the User-Agent at the moment the beacon arrives
(routers/activity.py), which is authoritative.  Rows written before that existed have
no User-Agent to consult, so for roughly a month of history the admin dashboard would
keep showing crawler-inflated numbers next to freshly filtered days — the 7-day and
30-day panels worst of all.  This script closes that gap, once, from behaviour.

The rule, and why each part of it is there:

    the session produced exactly one row, ever   a person who came for one page and
                                                 left produces this too, but a crawler
                                                 produces *nothing else*: no second
                                                 page, no click, no return
    that row is a page_view                      not a click (a click implies a first
                                                 page view under the same session, so
                                                 the session would not have one row)
    no referrer                                  Googlebot sends no Referer header;
                                                 an internal navigation always carries
                                                 the same-origin one
    the route is one CRAWLER_ROUTES lists        see below — the decisive one

Every part is necessary and none is sufficient; together they describe the shape the
2026-08-22..24 crawl left behind, in which 582 stock-page rows covered 580 distinct
URLs — one visit each, which is what a URL frontier does and what an audience does not.

The route restriction is not decoration, it is what keeps this rule honest.  The first
three conditions on their own also match 3,832 views of /map, and those are people: split
by hour, /map's single-view traffic peaks at 09:00 KST (market open) and bottoms out at
03:00, which is the audience's daily curve exactly.  A treemap really is a page someone
opens once, looks at, and closes.  Sorting single-view traffic by the ratio of its
overnight rate to its daytime rate separates the two populations with nothing in between:

    /discussion-explorer   120x     |   /dashboard        0.67x
    /investor/{code}        56x     |   /kospi-100        0.42x
    /stock/{code}           24x     |   /                 0.32x
    /desk                  4.4x     |   /kosdaq-map       0.29x
                                    |   /nasdaq100-map    0.26x
                                    |   /map              0.14x

Everything on the left runs while Korea sleeps and stops during market hours — the
inverse of an audience, and what a crawler scheduled elsewhere looks like.  Everything
on the right is the audience's own curve.  Only the left column is listed below.

It is still a heuristic over data that cannot be checked, so:

  * it defaults to a dry run and only writes with --apply,
  * it prints what it would touch, by day and by route, before touching anything,
  * --min-day/--max-day bound it to the range being corrected,
  * and it is reversible: `UPDATE page_views SET is_bot = 0 WHERE user_agent IS NULL`
    puts every row it changed back, since only pre-instrumentation rows have a NULL
    user_agent and only this script sets is_bot on them.

A person who bounced off one page with no referrer is misfiled by it.  That is the
error being accepted, in exchange for a month of history that is not dominated by a
crawler; the alternative — leaving it — is not neutral, it is the larger error in the
same direction.

Usage (from backend/):
    python -m scripts.backfill_bot_page_views                    # dry run
    python -m scripts.backfill_bot_page_views --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The request-path timeout is deliberately short (turso.DEFAULT_TIMEOUT is 6s) because a
# hung statement there holds a store lock and takes the site with it. This is a one-off
# batch whose selects group over the whole table, so it needs a batch-shaped budget
# instead. Set before the store module is imported, which is when it reads the value.
os.environ.setdefault("TURSO_HTTP_TIMEOUT", "120")

from app.services import page_view_store  # noqa: E402

# The left column of the table in the docstring: the routes whose single-view,
# no-referrer traffic is inverted-diurnal, i.e. runs overnight in Korea and stops during
# market hours. A frozen list rather than a statistic recomputed at run time - the
# measurement was made once, over the range this script exists to correct, and a rule
# that re-derives which routes to rewrite from the data it is about to rewrite is one
# nobody can review before running it.
#
# Two of these are the sitemap's own bulk (/stock/{code}, /investor/{code}); the other
# two are where the crawl went next by following internal links.
CRAWLER_ROUTES = (
    "path LIKE '/stock/%' OR path LIKE '/investor/%' "
    "OR path IN ('/discussion-explorer', '/desk')"
)

# Only rows that predate the user_agent column can be reclassified from behaviour;
# anything with a stored agent was already decided by the authoritative rule.
_SELECT = f"""
SELECT id FROM page_views
WHERE user_agent IS NULL
  AND is_bot = 0
  AND event_type = 'page_view'
  AND (referrer IS NULL OR referrer = '')
  AND created_at >= ? AND created_at < ?
  AND ({CRAWLER_ROUTES})
  AND session_id IN (
      SELECT session_id FROM page_views GROUP BY session_id HAVING COUNT(*) = 1
  )
"""

_ROUTE_LABEL = (
    "CASE WHEN path LIKE '/stock/%' THEN '/stock/{code}' "
    "WHEN path LIKE '/investor/%' THEN '/investor/{code}' "
    "WHEN path LIKE '/market-brief/%' THEN '/market-brief/{day}' "
    "ELSE path END"
)

# Turso takes the whole batch in one HTTP request, so the id list has to stay small
# enough to fit one; 500 is well inside it and keeps the progress line meaningful.
CHUNK = 500


def _preview(conn, ids: list[int], min_day: str, max_day: str) -> None:
    placeholders = ",".join("?" * len(ids))
    # Each day's overall page_view total comes back alongside the count being removed,
    # because the share is what makes the number reviewable: 200 rows out of 210 and
    # 200 out of 4,000 are very different things to agree to.
    by_day = conn.execute(
        "SELECT substr(created_at, 1, 10) AS day, "
        f"SUM(CASE WHEN id IN ({placeholders}) THEN 1 ELSE 0 END), COUNT(*) "
        "FROM page_views WHERE event_type = 'page_view' GROUP BY day ORDER BY day",
        ids,
    ).fetchall()
    by_route = conn.execute(
        f"SELECT {_ROUTE_LABEL}, COUNT(*) FROM page_views WHERE id IN ({placeholders}) "
        "GROUP BY 1 ORDER BY 2 DESC LIMIT 25",
        ids,
    ).fetchall()

    print(f"\n대상 {len(ids):,}행 (UTC {min_day} ~ {max_day})\n")
    print("  날짜별 (봇으로 표시할 행 / 그날 전체 page_view)")
    for day, count, total in by_day:
        if not count:
            continue
        print(f"    {day}  {count:>6,} / {total:>6,}  ({count / total * 100:5.1f}%)")
    print("\n  경로별")
    for route, count in by_route:
        print(f"    {count:>6,}  {route}")


def main() -> int:
    parser = argparse.ArgumentParser(description="과거 page_views의 크롤러 행을 is_bot=1로 표시")
    parser.add_argument("--apply", action="store_true", help="실제로 기록 (기본은 미리보기)")
    parser.add_argument("--min-day", default="2000-01-01", help="시작일 (UTC, YYYY-MM-DD)")
    parser.add_argument("--max-day", default="9999-12-31", help="종료일 exclusive (UTC, YYYY-MM-DD)")
    args = parser.parse_args()

    def _run(conn):
        ids = [row[0] for row in conn.execute(_SELECT, (args.min_day, args.max_day)).fetchall()]
        if not ids:
            print("표시할 행이 없습니다.")
            return
        _preview(conn, ids, args.min_day, args.max_day)
        if not args.apply:
            print("\n미리보기입니다. 반영하려면 --apply 를 붙여 다시 실행하세요.")
            return

        # Not one transaction, and it does not need to be: an interrupted run leaves
        # the rows it already marked marked, and re-running simply re-selects whatever
        # is still unmarked.
        marked = 0
        for start in range(0, len(ids), CHUNK):
            chunk = ids[start:start + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            conn.execute(f"UPDATE page_views SET is_bot = 1 WHERE id IN ({placeholders})", chunk)
            conn.commit()
            marked += len(chunk)
            print(f"  ... {marked:,}/{len(ids):,}")
        # page_views_daily caches each closed day's totals and never recomputes them,
        # so it still holds the pre-filter numbers. Dropping it makes every day
        # recompute on next request — the same thing page_view_store does when the
        # is_bot column is first added.
        conn.execute("DELETE FROM page_views_daily")
        conn.commit()
        print(f"\n{marked:,}행을 봇으로 표시하고 page_views_daily 캐시를 비웠습니다.")

    page_view_store._with_connection(_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
