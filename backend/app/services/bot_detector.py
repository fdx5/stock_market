"""Tells a crawler apart from a visitor, by User-Agent.

The admin dashboard's numbers are meant to be "how many people came", and for a
month they were not: this app's analytics are reported from the browser
(useActivityTracking.ts posts to /api/activity/event), and a JS-rendering crawler
runs that code exactly like a person does.  Worse, every render starts with a fresh
sessionStorage, so a crawl of N URLs mints N brand-new session ids — the crawler
does not look like one heavy visitor, it looks like N first-time visitors.  Over
2026-08-22..24 that put roughly 2,000 such sessions into page_views: 95% of one
day's "visitors", 580 stock pages each visited exactly once.

Nothing was recorded that could settle who it was, because neither the activity
endpoint nor the heartbeat looked at the request headers.  They do now — the
User-Agent is stored on the row and matched against the tokens below.

Why a token list and not a behavioural rule: a rule like "one page view, no
referrer" also describes a real person who opened a link and left, so it cannot be
used to *discard* traffic.  A UA saying `Googlebot` is the crawler operator telling
us outright.  Crawlers that lie about their UA are not caught here, by design —
this filter's job is to keep honest bots out of the visitor counts, not to fight
an adversary.  (Nothing here is a security control; access is not denied on it.)
"""

from __future__ import annotations

# Matched case-insensitively as substrings of the User-Agent.  Keep them specific
# enough not to catch a browser: "bot" alone would, via Cubot and Abot phones.
_BOT_TOKENS = (
    # Search engines
    "googlebot", "google-inspectiontool", "storebot-google", "google favicon",
    "apis-google", "mediapartners-google", "adsbot-google", "feedfetcher-google",
    "bingbot", "bingpreview", "adidxbot", "msnbot",
    "yeti",              # Naver
    "daumoa",            # Kakao/Daum — the crawler only; a bare "daum" also
                         # matches the Daum app's in-app browser, i.e. real readers
    "yandexbot", "yandex.com/bots",
    "baiduspider", "sogou", "exabot", "seznambot", "qwantify",
    "duckduckbot", "duckduckgo-favicons-bot",
    "slurp",             # Yahoo
    "petalbot",          # Huawei
    "coccocbot", "mojeekbot", "gigabot", "ia_archiver",
    # AI / LLM crawlers
    "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-web",
    "anthropic-ai", "perplexitybot", "perplexity-user", "youbot", "ccbot",
    "google-extended", "applebot", "amazonbot", "bytespider", "diffbot",
    "meta-externalagent", "facebookbot", "imagesiftbot", "omgili", "timpibot",
    "cohere-ai", "img2dataset",
    # Link unfurlers and preview fetchers — not people either
    "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot",
    "telegrambot", "discordbot", "whatsapp", "skypeuripreview",
    "embedly", "quora link preview", "pinterestbot", "redditbot", "kakaotalk-scrap",
    # SEO / monitoring / generic tooling
    "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "rogerbot", "screaming frog",
    "serpstatbot", "dataforseobot", "blexbot", "seokicks", "sistrix",
    "uptimerobot", "pingdom", "statuscake", "site24x7", "newrelicpinger",
    "curl/", "wget/", "python-requests", "python-urllib", "httpx/", "aiohttp",
    "go-http-client", "java/", "okhttp", "axios/", "node-fetch", "got (",
    "headlesschrome", "phantomjs", "scrapy", "puppeteer", "playwright",
    "lighthouse", "chrome-lighthouse", "pagespeed", "gtmetrix",
    "spider", "crawler", "crawling",
)

# A truncation ceiling for what gets stored, not a validation rule: real agent
# strings run ~120 chars, and the field exists so an unrecognised crawler can be
# identified later, not to keep an unbounded blob per row.
MAX_USER_AGENT_LEN = 200


def normalize_user_agent(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    return user_agent.strip()[:MAX_USER_AGENT_LEN] or None


def is_bot(user_agent: str | None) -> bool:
    """True when the User-Agent identifies itself as a crawler, unfurler or tool.

    A missing User-Agent counts as a bot: every browser sends one, so an activity
    beacon arriving without it is a script — and that is also the shape a spoofer
    who simply strips the header takes.
    """
    if not user_agent or not user_agent.strip():
        return True
    lowered = user_agent.lower()
    return any(token in lowered for token in _BOT_TOKENS)
