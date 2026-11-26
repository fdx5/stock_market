"""Threads posts lead with the Investing community topic (scripts/social_publish.threads_topic)."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts import social_publish as publish  # noqa: E402


def first_tag(text):
    return re.search(r"(?<!\S)#[^\s#]+", text).group()


def test_movers_caption_gets_the_community_topic_first():
    text = ("11/26 장 초반 급등 이유\n반도체 장비주 강세\n\n급등 이유 보기 https://kospimap.com/movers?utm_source=threads#s1\n"
            "#급등주 #특징주 #주식 #삼성전자")
    out = publish.threads_topic(text)
    assert first_tag(out) == "#Investing"
    assert out.splitlines()[0] == "11/26 장 초반 급등 이유"            # headline (post_status key) untouched
    assert "#급등주 #특징주 #주식 #삼성전자" in out and "movers?utm_source=threads#s1" in out
    assert out.count("#Investing") == 1


def test_no_duplicate_and_no_hashtags_case():
    assert publish.threads_topic("a\n#investing #코스피").count("#Investing") == 1
    assert first_tag(publish.threads_topic("a\nhttps://kospimap.com/x#s2")) == "#Investing"


def test_long_caption_drops_trailing_tags_not_the_topic():
    body = "가" * 470
    text = f"헤드라인\n{body}\n#코스피 #코스닥 #증시뉴스 #장마감"
    out = publish.threads_topic(text)
    assert publish.caption_fits("threads", out)
    assert first_tag(out) == "#Investing" and "#코스피" in out and "#장마감" not in out
