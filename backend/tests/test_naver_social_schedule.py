import datetime as dt
from zoneinfo import ZoneInfo

from app.services import naver_social_content as content
from app.services import naver_social_publisher as pub

KST = ZoneInfo("Asia/Seoul")


def at(y, m, d, hh, mm):
    return dt.datetime(y, m, d, hh, mm, tzinfo=KST)


def test_every_sns_edition_has_a_blog_twin():
    from app.services import ops_timeline

    assert {e for e, *_ in ops_timeline.SNS} == set(content.EDITIONS)
    for edition, (hhmm, *_rest) in content.EDITIONS.items():
        sns = next(t for e, t, *_ in ops_timeline.SNS if e == edition)
        assert hhmm == sns or (edition in ("morning", "evening")), edition


def test_due_follows_sns_time_and_window():
    # Friday 2026-11-27 (KRX open; US half day is still a session).
    assert (dt.date(2026, 11, 27), "movers_open") not in pub.due(at(2026, 11, 27, 9, 29))
    assert (dt.date(2026, 11, 27), "movers_open") in pub.due(at(2026, 11, 27, 9, 30))
    assert (dt.date(2026, 11, 27), "movers_open") not in pub.due(at(2026, 11, 27, 12, 31))
    assert (dt.date(2026, 11, 27), "close") in pub.due(at(2026, 11, 27, 21, 59))


def test_market_rules():
    # Thanksgiving 2026-11-26: no US session, so the US editions that cover it are off.
    assert not pub.applies(dt.date(2026, 11, 26), "us_movers_pre")      # 21:10 KST covers 11/26 US
    assert not pub.applies(dt.date(2026, 11, 27), "us_movers_open")     # 00:50 KST covers 11/26 US
    assert not pub.applies(dt.date(2026, 11, 27), "nasdaq_close")       # 07:00 KST after 11/26 US
    assert pub.applies(dt.date(2026, 11, 26), "nasdaq_close")           # after 11/25 US
    # Saturday: KRX editions off, world scoreboards and hot issues on.
    sat = dt.date(2026, 11, 28)
    assert not pub.applies(sat, "close") and pub.applies(sat, "world_morning") and pub.applies(sat, "morning")


def test_links_carry_the_campaign():
    url = content.link("/map", dt.date(2026, 11, 26), "close", "#s1")
    assert url.startswith("https://kospimap.com/map?utm_source=naver_blog&utm_medium=referral")
    assert "utm_campaign=nb_close-20261126" in url and url.endswith("#s1")


def test_tags_are_clean_and_capped():
    tags = content.clean_tags(["#코스피", "코스피", "S&P 500", "x", "AI 반도체 쇼크", "1234"] + [f"태그{i}" for i in range(30)], 10)
    assert tags[:3] == ["코스피", "SP500", "AI반도체쇼크"] and len(tags) == 10
