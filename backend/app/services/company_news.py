import hashlib

from app.data.company_news_fetcher import fetch_article_content, get_company_news
from app.data.translate_fetcher import translate_batch_via_single_call, translate_to_korean
from app.services.cache import cache

# News content itself is short-lived (a company's latest headlines change within
# minutes), matching news_fetcher.TTL_NEWS_SECONDS; a given headline's translation
# never changes once computed, so it's cached far longer (see TTL_TRANSLATION in
# services/translation.py for the same reasoning applied to other scraped text).
TTL_NEWS_SECONDS = 15 * 60
TTL_TRANSLATION_SECONDS = 7 * 24 * 3600
TTL_ARTICLE_SECONDS = 60 * 60


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _translate_cached(text: str) -> str:
    if not text:
        return text
    key = f"news_ko:{_sha1(text)}"
    return cache.get_or_set(key, TTL_TRANSLATION_SECONDS, lambda: translate_to_korean(text))


def get_company_news_cached(code: str, company_name: str) -> list[dict]:
    return cache.get_or_set(f"company_news:{code}", TTL_NEWS_SECONDS, lambda: get_company_news(code, company_name))


def get_company_news_translated(code: str, company_name: str, lang: str = "ko") -> list[dict]:
    items = get_company_news_cached(code, company_name)

    # Korean-company items are already in Korean (scraped from Naver), and an
    # explicit lang=en caller wants the raw scraped text either way — translation
    # only applies to the foreign-company/Bing-News path when Korean is requested.
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


def _translate_paragraphs(paragraphs: list[str]) -> list[str]:
    """Mirrors the batch-with-per-item-fallback pattern translation.py already uses
    for ko->en: one request for the whole article is far cheaper than one per
    paragraph, but translate_batch_via_single_call returns None rather than risk a
    misaligned batch (Google occasionally merges/splits lines differently), in which
    case each paragraph is translated individually instead."""
    batch = translate_batch_via_single_call(paragraphs, source_lang="en", target_lang="ko")
    if batch is not None:
        return batch
    return [translate_to_korean(p) for p in paragraphs]


def get_article_content_translated(url: str, is_korean_source: bool, lang: str = "ko") -> dict | None:
    """Fetches (and caches) the full article body for a news item the user clicked
    on, translating it if it's a foreign-language source and Korean was requested.
    Returns None if extraction failed — the caller/frontend falls back to the list's
    own title/snippet plus an external link rather than showing an empty popup."""
    raw_paragraphs = cache.get_or_set(f"article:{_sha1(url)}", TTL_ARTICLE_SECONDS, lambda: fetch_article_content(url))
    if not raw_paragraphs:
        return None

    if is_korean_source or lang != "ko":
        return {"paragraphs": raw_paragraphs}

    translated = cache.get_or_set(
        f"article_ko:{_sha1(url)}", TTL_TRANSLATION_SECONDS, lambda: _translate_paragraphs(raw_paragraphs)
    )
    return {"paragraphs": translated}
