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
    "headlesschrome", "headlessshell", "phantomjs", "scrapy", "puppeteer", "playwright", "selenium", "cypress/",
    "googleother", "google-safety", "amazonadbot", "facebookcatalog",
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


# Families for the growth control room's bot panel: which kind of automation a
# declared-bot row came from. Order matters — the first family whose token matches
# wins, so the specific operators come before the generic "spider"/"crawler" words.
_FAMILIES = (
    ("search", "검색엔진 크롤러", ("googlebot", "google-inspectiontool", "storebot-google", "google favicon",
        "apis-google", "mediapartners-google", "adsbot-google", "feedfetcher-google", "googleother",
        "google-safety", "bingbot", "bingpreview", "adidxbot", "msnbot", "yeti", "daumoa", "yandex",
        "baiduspider", "sogou", "exabot", "seznambot", "qwantify", "duckduck", "slurp", "petalbot",
        "coccocbot", "mojeekbot", "gigabot", "ia_archiver", "applebot")),
    ("ai", "AI·LLM 크롤러", ("gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-web", "anthropic-ai",
        "perplexity", "youbot", "ccbot", "google-extended", "amazonbot", "bytespider", "diffbot",
        "meta-externalagent", "facebookbot", "imagesiftbot", "omgili", "timpibot", "cohere-ai", "img2dataset")),
    ("preview", "링크 미리보기", ("facebookexternalhit", "twitterbot", "linkedinbot", "slackbot", "telegrambot",
        "discordbot", "whatsapp", "skypeuripreview", "embedly", "quora link preview", "pinterestbot",
        "redditbot", "kakaotalk-scrap", "facebookcatalog")),
    ("seo", "SEO·성능 도구", ("ahrefsbot", "semrushbot", "mj12bot", "dotbot", "rogerbot", "screaming frog",
        "serpstatbot", "dataforseobot", "blexbot", "seokicks", "sistrix", "lighthouse", "pagespeed", "gtmetrix",
        "amazonadbot")),
    ("monitor", "가용성 모니터링", ("uptimerobot", "pingdom", "statuscake", "site24x7", "newrelicpinger")),
    ("headless", "헤드리스·자동화 브라우저", ("headlesschrome", "headlessshell", "phantomjs", "puppeteer",
        "playwright", "selenium", "cypress/")),
    ("script", "스크립트·HTTP 클라이언트", ("curl/", "wget/", "python-requests", "python-urllib", "httpx/",
        "aiohttp", "go-http-client", "java/", "okhttp", "axios/", "node-fetch", "got (", "scrapy")),
)
FAMILY_LABELS = {key: label for key, label, _ in _FAMILIES} | {
    "other": "기타 크롤러", "no_agent": "User-Agent 없음", "webdriver": "웹드라이버(자동화 표시)",
    "suspected": "자동화 의심(위장 브라우저)",
}


def family(user_agent: str | None) -> str:
    """The bot family key of a declared-bot row (see FAMILY_LABELS)."""
    if not user_agent or not user_agent.strip():
        return "no_agent"
    lowered = user_agent.lower()
    for key, _, tokens in _FAMILIES:
        if any(token in lowered for token in tokens):
            return key
    return "other" if is_bot(user_agent) else "webdriver"


def short_agent(user_agent: str | None) -> str:
    """A readable name for an agent string: the bot token or browser/version it carries."""
    if not user_agent:
        return "(User-Agent 없음)"
    lowered = user_agent.lower()
    for _, _, tokens in _FAMILIES:
        for token in tokens:
            if token in lowered:
                start = lowered.index(token)
                end = start + len(token)
                while end < len(user_agent) and (user_agent[end].isalnum() or user_agent[end] in "/.-_"):
                    end += 1
                return user_agent[start:end].strip(" /;(")
    import re
    for pattern in (r"(SamsungBrowser/[\d.]+)", r"(Edg/\d+)", r"(Whale/\d+)", r"(Firefox/\d+)",
                    r"(Chrome/\d+)", r"(Version/[\d.]+).*Safari"):
        match = re.search(pattern, user_agent)
        if match:
            os_name = next((name for token, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"),
                            ("Windows", "Windows"), ("Macintosh", "Mac"), ("CrOS", "ChromeOS"), ("Linux", "Linux"))
                            if token in user_agent), "?")
            return f"{match.group(1)} · {os_name}"
    return user_agent[:60]


def disguise_signals(user_agent: str | None) -> list[str]:
    """Signals that an agent string which does *not* declare itself a bot is still
    unlikely to be a person's browser. Used only to mark a cohort as suspected — on
    its own a signal never reclassifies a visit (see growth_control._suspected_agents).
    """
    import re
    if not user_agent:
        return ["no_agent"]
    signals = []
    if not user_agent.startswith("Mozilla/"):
        signals.append("non_browser_format")
    chrome = re.search(r"Chrome/(\d+)", user_agent)
    if chrome and int(chrome.group(1)) < 100 and "Edg" not in user_agent:
        signals.append("outdated_chrome")
    firefox = re.search(r"Firefox/(\d+)", user_agent)
    if firefox and int(firefox.group(1)) < 90:
        signals.append("outdated_firefox")
    safari = re.search(r"Version/(\d+)[\d.]* (Mobile/\S+ )?Safari", user_agent)
    if safari and int(safari.group(1)) < 13:
        signals.append("outdated_safari")
    if re.search(r"X11; Linux x86_64", user_agent) and "Android" not in user_agent:
        signals.append("server_linux")
    return signals
