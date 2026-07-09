import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.data.translate_fetcher import translate_to_english
from app.services.cache import cache

# Translations of the same text don't change, so they're cached far longer than any
# live-data cache in this app — a stock name or a sector label translated once stays
# correct indefinitely, and even a news headline is never re-translated once seen.
TTL_TRANSLATION_SECONDS = 7 * 24 * 3600

# Machine translation picks the wrong sense for a few common tickers that are also
# ordinary Korean words (e.g. "기아" is both Kia Corporation and the word "starvation") —
# override those specific known cases rather than trying to audit the whole universe.
_KNOWN_OVERRIDES: dict[str, str] = {
    "기아": "Kia Corporation",
    "카카오": "Kakao Corp",
}


def _cache_key(text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return f"translate_en:{digest}"


def _translate_one(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return text
    if stripped in _KNOWN_OVERRIDES:
        return _KNOWN_OVERRIDES[stripped]
    return cache.get_or_set(_cache_key(stripped), TTL_TRANSLATION_SECONDS, lambda: translate_to_english(stripped))


def translate_batch_to_english(texts: list[str]) -> list[str]:
    """Translates many strings at once, in parallel, each cached independently so a
    repeated name/headline across pages or polls only ever pays for one live
    translation call. A failed item falls back to its own original text rather than
    failing the whole batch."""
    if not texts:
        return []

    results: list[str] = list(texts)
    with ThreadPoolExecutor(max_workers=min(20, len(texts))) as pool:
        futures = {pool.submit(_translate_one, text): i for i, text in enumerate(texts)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                results[i] = future.result()
            except Exception:
                results[i] = texts[i]
    return results
