from datetime import date

import pytest

from scripts import social_publish, weekly_market_social as weekly


def test_us_holiday_does_not_replace_either_weekly_close():
    prices = {
        "2026-11-20": 22_617.73,
        "2026-11-23": 24_089.56,
        "2026-11-24": 23_733.54,
        "2026-11-25": 23_585.80,
        "2026-11-27": 24_129.50,
        "2026-11-30": 24_500.00,
    }

    def read_json(_):
        return {"items": [{"code": "IXIC", "points": [
            {"date": day, "close": close} for day, close in prices.items()
        ]}]}

    monday, friday = date(2026, 11, 23), date(2026, 11, 27)
    rows = weekly._read_prices(read_json, "IXIC", "US", monday, friday)
    assert [day.day for day, _ in rows] == [20, 23, 24, 25, 27]
    assert weekly.signed(weekly.change(rows[-1][1], rows[0][1])) == "+6.68%"
    prices.pop("2026-11-27")
    with pytest.raises(weekly.NotReady, match="2026-11-27"):
        weekly._read_prices(read_json, "IXIC", "US", monday, friday)


def test_weekly_captions_preserve_topics_and_channel_tracking():
    day = date(2026, 11, 28)
    rows = ((date(2026, 11, 20), 100.0), (date(2026, 11, 27), 109.0))
    report = weekly.Week(day, tuple(weekly.Market(code, name, path, rows, (), watch)
                                    for code, name, _, path, watch in weekly.SPECS), ())
    captions = weekly.captions(report, social_publish.caption_fits)
    for service, source in (("threads", "threads"), ("twitter", "x"), ("bluesky", "bluesky")):
        text = captions[service]
        if service == "threads":
            text = social_publish.threads_topic(text)
        assert text.splitlines()[0] == weekly.headline(day)
        assert social_publish.caption_fits(service, text)
        assert f"utm_source={source}" in text
        assert "utm_campaign=weekly_market-20261128" in text
        assert all("#" + tag in text for tag in weekly.TAGS[:4])
