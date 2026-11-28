"""One inflow type per session, so SNS, blog, shares and external search can be compared.

The tagging convention every link we publish follows (producers: scripts/social_publish.py,
movers_social.py, world_indices_social.py, naver_social_content.py, naver_document_model.py,
frontend share buttons, public widgets/feeds):

  utm_source   the platform the link sits on      x · threads · bluesky · naver_blog · kakaotalk ·
                                                   native_share · link_copy · market_widget · calendar
  utm_medium   how it got there                    social  — our automated SNS posts
                                                   blog    — our Naver blog posts
                                                   share   — a visitor's share button / copied link
                                                   referral— widgets, feeds, embeds on other sites
                                                   reminder/email — alerts we send
  utm_campaign the post or program                 <edition>-<YYYYMMDD>          (SNS post)
                                                   nb_<edition>-<YYYYMMDD>       (blog post)
                                                   nb_brief_<market>-<YYYYMMDD>  (blog closing brief)
                                                   <feature>[_<id>]             (shares, widgets)

Untagged visits are classified from the referrer host. Older links (medium=social on shares,
medium=referral on blog posts, undated campaigns) are still recognised.
"""
from __future__ import annotations

import re

TYPES = ("sns_auto", "sns_tagged", "naver_blog", "share", "community", "search", "ai", "referral", "email", "direct")
TYPE_LABELS = {
    "sns_auto": "자동 SNS 게시 (X·Threads·Bluesky)",
    "sns_tagged": "SNS 수동 게시 (UTM 태그)",
    "naver_blog": "네이버 블로그 게시물",
    "share": "방문자 공유 (카톡·공유·링크복사)",
    "community": "커뮤니티·SNS (태그 없음)",
    "search": "검색엔진",
    "ai": "AI 답변 (ChatGPT 등)",
    "referral": "외부 링크·위젯",
    "email": "메일·알림",
    "direct": "직접·미식별",
}
# Coarse groups for the headline split.
GROUPS = {"sns": ("sns_auto", "sns_tagged", "naver_blog", "share", "community"), "search": ("search",), "ai": ("ai",),
          "other": ("referral", "email", "direct")}
GROUP_LABELS = {"sns": "SNS·블로그·커뮤니티", "search": "외부 검색", "ai": "AI 답변", "other": "기타(외부링크·알림·직접)"}
# Types whose visits come only from links we tag ourselves.
OWNED = ("sns_auto", "sns_tagged", "naver_blog", "share")

_AUTO_SNS = {"x", "twitter", "threads", "bluesky"}
# Programs the automated SNS batch posts (naver_social_content.EDITIONS, plus the undated
# names older posts used). A tagged SNS link with any other campaign was posted by hand.
AUTO_PROGRAMS = {"us_movers_open", "us_movers_close", "nasdaq_close", "morning", "world_morning", "movers_open",
                 "midday", "movers_noon", "close", "movers_close", "world_evening", "us_movers_pre", "evening",
                 "hot_issues", "market_close", "world_indices", "weekly_market"}
_SHARE = {"kakaotalk", "kakao", "native_share", "link_copy", "share"}
_SEARCH = (("googlequicksearchbox", "google"), ("google.", "google"), ("search.naver", "naver"),
           ("search.daum", "daum"), ("bing.", "bing"), ("duckduckgo", "duckduckgo"), ("search.yahoo", "yahoo"),
           ("yahoo.co", "yahoo"), ("ecosia", "ecosia"), ("zum.com", "zum"), ("search.nate", "nate"),
           ("baidu.", "baidu"), ("yandex.", "yandex"))
_SEARCH_NAMES = {"google", "naver", "daum", "bing", "duckduckgo", "yahoo", "ecosia", "zum", "nate", "baidu", "yandex"}
_AI = (("chatgpt", "chatgpt"), ("openai", "chatgpt"), ("perplexity", "perplexity"), ("copilot", "copilot"),
       ("gemini.google", "gemini"), ("claude.ai", "claude"), ("wrtn", "wrtn"), ("liner", "liner"))
_EMAIL = (("com.google.android.gm", "gmail"), ("mail.", "mail"), ("outlook", "outlook"))
_COMMUNITY = (("bsky.app", "bluesky"), ("threads.", "threads"), ("x.com", "x"), ("t.co", "x"), ("twitter.", "x"),
              ("facebook.", "facebook"), ("instagram.", "instagram"), ("youtube.", "youtube"), ("reddit.", "reddit"),
              ("t.me", "telegram"), ("telegram.", "telegram"), ("band.us", "band"), ("kakao", "kakao"),
              ("blog.naver", "naver_blog"), ("cafe.naver", "naver_cafe"), ("linkedin.", "linkedin"),
              ("tistory.com", "tistory"), ("dcinside", "dcinside"), ("fmkorea", "fmkorea"), ("clien.net", "clien"),
              ("ppomppu", "ppomppu"), ("theqoo", "theqoo"), ("ruliweb", "ruliweb"), ("discord", "discord"),
              ("paxnet", "paxnet"), ("damoang", "damoang"), ("etoland", "etoland"), ("daytrading", "daytrading"))
_SELF = ("kospimap.com", "onrender.com", "localhost", "127.0.0.1")
_DATE = re.compile(r"[-_](20\d{6}|20\d{2}-\d{2}-\d{2})(?:[-_].*)?$")


def _match(table, value: str):
    return next((name for token, name in table if token in value), False)


def program(campaign: str) -> str:
    """The post family of a campaign with its date removed ("nb_close-20261126" -> "close")."""
    c = (campaign or "").strip()
    if not c:
        return "(태그 없음)"
    c = re.sub(r"^nb_", "", c)
    c = _DATE.sub("", c)
    c = re.sub(r"^market_brief$", "brief", c)
    return c or "(태그 없음)"


def campaign_day(campaign: str) -> str | None:
    m = re.search(r"(20\d{2})-?(\d{2})-?(\d{2})", campaign or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def classify(utm_source: str = "", utm_medium: str = "", utm_campaign: str = "", host: str = "",
             channel: str = "", source_name: str = "") -> tuple[str, str, str]:
    """(type, platform, program) for one session's first page."""
    src = (utm_source or "").strip().lower()
    med = (utm_medium or "").strip().lower()
    camp = (utm_campaign or "").strip()
    host = (host or "").strip().lower().removeprefix("www.").removeprefix("m.")
    prog = program(camp) if camp else ""

    if src:
        if re.search(r"email|newsletter|mail|reminder|notify|push|calendar", f"{src} {med}"):
            return "email", src, prog
        if src == "naver_blog" or med == "blog" or camp.startswith("nb_"):
            return "naver_blog", "naver_blog", prog or "(태그 없음)"
        if src in _AUTO_SNS and (med in ("social", "") and prog in AUTO_PROGRAMS):
            return "sns_auto", "x" if src == "twitter" else src, prog
        if src in _AUTO_SNS and med == "social":
            return "sns_tagged", "x" if src == "twitter" else src, prog or "(태그 없음)"
        if src in _SHARE or med == "share":
            return "share", src, prog or "(태그 없음)"
        hit = _match(_AI, src)
        if hit:
            return "ai", hit, ""
        if med in ("cpc", "ppc", "paid", "search", "organic") or src in _SEARCH_NAMES or _match(_SEARCH, src):
            return "search", _match(_SEARCH, src) or src, prog
        if med in ("referral", "embed", "widget", "feed"):
            return "referral", src, prog
        if src in _AUTO_SNS or med == "social":
            # A tag we did not write (manual post, old link) — still social, kept apart from automation.
            return "community", "x" if src == "twitter" else src, prog
        if src.startswith("ig_") or "instagram" in src:
            return "community", "instagram", ""
    if host:
        if any(s in host for s in _SELF):
            return "direct", "direct", ""
        for table, kind in ((_AI, "ai"), (_EMAIL, "email")):
            hit = _match(table, host)
            if hit:
                return kind, hit, ""
        hit = _match(_SEARCH, host)
        if hit:
            return "search", hit, ""
        if "naver.com" in host and "keep" not in host and "blog" not in host and "cafe" not in host:
            return "search", "naver", ""
        hit = _match(_COMMUNITY, host)
        if hit:
            return ("naver_blog" if hit == "naver_blog" else "community"), hit, ("(태그 없음)" if hit == "naver_blog" else "")
        return "referral", host.replace("keep.naver.com", "naver_keep"), ""
    if (channel or "") == "search" and source_name:
        return "search", source_name.lower(), ""
    return "direct", "direct", ""


def group_of(kind: str) -> str:
    return next((g for g, kinds in GROUPS.items() if kind in kinds), "other")
