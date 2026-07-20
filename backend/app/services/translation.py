import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote

from app.data.translate_fetcher import (
    translate_batch_via_single_call,
    translate_to_english,
    translate_to_korean,
)
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

# Conservative budget for the percent-encoded `q` value of one grouped translate
# request. Korean text expands roughly 9x once URL-percent-encoded (3 UTF-8 bytes per
# character, 3 characters per %XX), so this keeps even a batch of all-Korean text
# comfortably under typical server/proxy URL-length limits (usually 2,000-8,000 chars)
# without assuming a fixed item count — callers here range from short stock names to
# much longer news headlines.
_MAX_BATCH_QUERY_CHARS = 1500


def _cache_key(text: str, prefix: str = "translate_en") -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return f"{prefix}:{digest}"


def _group_into_safe_batches(texts: list[str]) -> list[list[str]]:
    batches: list[list[str]] = []
    current: list[str] = []
    current_len = 0
    for text in texts:
        added_len = len(quote(text, safe="")) + 3  # +3 for the "%0A" join separator
        if current and current_len + added_len > _MAX_BATCH_QUERY_CHARS:
            batches.append(current)
            current, current_len = [], 0
        current.append(text)
        current_len += added_len
    if current:
        batches.append(current)
    return batches


def _translate_individually(texts: list[str], target_lang: str) -> list[str]:
    """One Google request per text, run concurrently — the fallback path for a batch
    whose single grouped request failed or came back misaligned, so a batching hiccup
    only costs that batch's slice of the speed win instead of corrupting results."""
    translate_one = translate_to_korean if target_lang == "ko" else translate_to_english
    results: list[str] = list(texts)
    with ThreadPoolExecutor(max_workers=min(20, len(texts))) as pool:
        futures = {pool.submit(translate_one, text): i for i, text in enumerate(texts)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                results[i] = future.result()
            except Exception:
                results[i] = texts[i]
    return results


def _translate_batch(batch: list[str], source_lang: str, target_lang: str) -> list[str]:
    result = translate_batch_via_single_call(batch, source_lang=source_lang, target_lang=target_lang)
    return result if result is not None else _translate_individually(batch, target_lang)


def _translate_many(texts: list[str], source_lang: str, target_lang: str) -> list[str]:
    """Fetches translations for texts that aren't cached and aren't a known override.
    Grouped into a handful of batched Google requests (see _group_into_safe_batches)
    instead of one request per text, cutting request count by roughly the average
    batch size — e.g. a ~2,700-name backfill drops from ~2,700 requests to a few dozen."""
    batches = _group_into_safe_batches(texts)
    if not batches:
        return []
    with ThreadPoolExecutor(max_workers=min(10, len(batches))) as pool:
        batch_results = list(pool.map(lambda batch: _translate_batch(batch, source_lang, target_lang), batches))
    return [item for batch in batch_results for item in batch]


def _translate_batch_cached(texts: list[str], source_lang: str, target_lang: str, cache_prefix: str) -> list[str]:
    """Shared implementation behind translate_batch_to_english/translate_batch_to_korean:
    each string is cached independently (7-day TTL) so a repeated name/headline across
    pages or polls only ever pays for one live translation. Texts not already cached are
    grouped into a handful of batched Google requests rather than one request per text
    (see _translate_many); a failed text falls back to its own original text rather than
    failing the whole call."""
    if not texts:
        return []

    results: list[str | None] = [None] * len(texts)
    to_fetch: list[tuple[int, str]] = []

    for i, text in enumerate(texts):
        stripped = text.strip()
        if not stripped:
            results[i] = text
            continue
        if target_lang == "en" and stripped in _KNOWN_OVERRIDES:
            results[i] = _KNOWN_OVERRIDES[stripped]
            continue
        cached = cache.peek(_cache_key(stripped, cache_prefix))
        if cached is not None:
            results[i] = cached
        else:
            to_fetch.append((i, stripped))

    if to_fetch:
        fetched = _translate_many([stripped for _, stripped in to_fetch], source_lang, target_lang)
        for (i, stripped), translated in zip(to_fetch, fetched):
            cache.get_or_set(
                _cache_key(stripped, cache_prefix), TTL_TRANSLATION_SECONDS, lambda translated=translated: translated
            )
            results[i] = translated

    return [text if r is None else r for text, r in zip(texts, results)]


def translate_batch_to_english(texts: list[str]) -> list[str]:
    """Translates many Korean strings to English (see _translate_batch_cached)."""
    return _translate_batch_cached(texts, source_lang="ko", target_lang="en", cache_prefix="translate_en")


def translate_batch_to_korean(texts: list[str]) -> list[str]:
    """Translates many English strings to Korean (see _translate_batch_cached). Used
    for the US stock universe's search-by-Korean-name index, mirroring
    translate_batch_to_english's role in universe.py for the reverse direction."""
    return _translate_batch_cached(texts, source_lang="en", target_lang="ko", cache_prefix="translate_ko")
