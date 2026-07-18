import hashlib

from app.data.company_news_fetcher import get_company_news
from app.data.translate_fetcher import translate_to_korean
from app.services.cache import cache

# News content itself is short-lived (a company's latest headlines change within
# minutes), matching news_fetcher.TTL_NEWS_SECONDS; a given headline's translation
# never changes once computed, so it's cached far longer (see TTL_TRANSLATION in
# services/translation.py for the same reasoning applied to other scraped text).
TTL_NEWS_SECONDS = 15 * 60
TTL_TRANSLATION_SECONDS = 7 * 24 * 3600


def _translate_cached(text: str) -> str:
    if not text:
        return text
    key = f"news_ko:{hashlib.sha1(text.encode('utf-8')).hexdigest()}"
    return cache.get_or_set(key, TTL_TRANSLATION_SECONDS, lambda: translate_to_korean(text))


def get_company_news_cached(code: str, company_name: str) -> list[dict]:
    return cache.get_or_set(f"company_news:{code}", TTL_NEWS_SECONDS, lambda: get_company_news(code, company_name))


def get_company_news_translated(code: str, company_name: str, lang: str = "ko") -> list[dict]:
    items = get_company_news_cached(code, company_name)

    # Korean-company items are already in Korean (scraped from Naver), and an
    # explicit lang=en caller wants the raw scraped text either way — translation
    # only applies to the foreign-company/Google-News path when Korean is requested.
    if lang != "ko" or code.endswith(".KS"):
        return items

    return [
        {
            **it,
            "title": _translate_cached(it["title"]),
            "snippet": _translate_cached(it["snippet"]) if it.get("snippet") else None,
        }
        for it in items
    ]
