"""Every site link leaving the SNS pipeline is tagged; hand-written promo posts are queued."""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts import social_publish as sp  # noqa: E402


def test_tag_links_tags_bare_and_full_links_once():
    text = ("드론 플레이하기 : kospimap.com/drone-explore\n홈 https://kospimap.com/ 그리고 "
            "https://kospimap.com/map?utm_source=threads&utm_medium=social&utm_campaign=midday-20261126")
    out = sp.tag_links(text, "threads", "promo_drone-20261126")
    assert "https://kospimap.com/drone-explore?utm_source=threads&utm_medium=social&utm_campaign=promo_drone-20261126" in out
    assert "https://kospimap.com/?utm_source=threads" in out
    assert out.count("utm_campaign=midday-20261126") == 1 and not sp.untagged_links(out)
    assert "utm_source=x&" in sp.tag_links("kospimap.com/map", "twitter", "c")
    assert sp.tag_links("mail me@kospimap.com", "threads", "c") == "mail me@kospimap.com"


def test_promo_file_is_read_and_due_in_its_window(tmp_path, monkeypatch):
    (tmp_path / "2026-11-27-drone.md").write_text(
        "---\npublish_at: 2026-11-27 19:00\ncampaign: drone_godeok\nnetworks: threads, x\nthreads_topic: none\n---\n"
        "고덕동 드론뷰\n체험: kospimap.com/drone-explore\n#드론", encoding="utf-8")
    (tmp_path / "bad.md").write_text("no front matter", encoding="utf-8")
    monkeypatch.setattr(sp, "PROMO_DIR", tmp_path)
    at = dt.datetime(2026, 11, 27, 19, 0, tzinfo=sp.KST)
    assert sp.due_promos(at - dt.timedelta(minutes=1)) == []
    [promo] = sp.due_promos(at + dt.timedelta(minutes=20))
    assert promo["networks"] == ["threads", "twitter"] and promo["campaign"] == "drone_godeok"
    caption = sp.promo_caption(promo, "threads")
    assert "utm_campaign=promo_drone_godeok-20261127" in caption and "#Investing" not in caption
    assert sp.due_promos(at + dt.timedelta(hours=7)) == []
    promo["threads_topic"] = "Investing"
    assert sp.promo_caption(promo, "threads").count("#Investing") == 1
