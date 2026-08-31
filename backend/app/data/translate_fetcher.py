from html import unescape

import requests

# Unofficial but widely used no-auth endpoints for short, occasional translations —
# no API key/quota setup needed for a feature this small.
#
# CHROME_TRANSLATE_URL is tried first and is the one that actually answers: the
# translate_a/single host below now returns HTTP 429 ("Sorry...") to server IPs
# regardless of User-Agent, and the MyMemory fallback answers 429 with its own
# quota-exhausted notice — between them every translate call fell through to
# returning the original text, which is what silently left the global stock page's
# 기업개요 and 관련뉴스 in English. The Chrome dictionary-extension endpoint is not
# rate-limited the same way, and it takes repeated `q` parameters and answers with
# one string per `q`, in order, so a batch needs neither newline-splitting nor an
# alignment guess.
CHROME_TRANSLATE_URL = "https://clients5.google.com/translate_a/t"
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
FALLBACK_TRANSLATE_URL = "https://api.mymemory.translated.net/get"

# Sent on every call: these endpoints treat a bare python-requests UA as a bot.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

# One GET carries the whole batch, so the query string has to stay a sane length.
CHROME_BATCH_ITEMS = 20
CHROME_BATCH_CHARS = 1400


def _chrome_batches(texts: list[str]) -> list[list[str]]:
    """Groups texts into requests, keeping a single over-long text as its own batch
    rather than dropping it — callers pre-split long prose with _translation_chunks."""
    batches: list[list[str]] = []
    current: list[str] = []
    size = 0
    for text in texts:
        if current and (len(current) >= CHROME_BATCH_ITEMS or size + len(text) > CHROME_BATCH_CHARS):
            batches.append(current)
            current, size = [], 0
        current.append(text)
        size += len(text)
    if current:
        batches.append(current)
    return batches


def _chrome_request(texts: list[str], source_lang: str, target_lang: str) -> list[str] | None:
    params = [("client", "dict-chrome-ex"), ("sl", source_lang), ("tl", target_lang)]
    params += [("q", text) for text in texts]
    resp = requests.get(CHROME_TRANSLATE_URL, params=params, headers=HEADERS, timeout=8)
    resp.raise_for_status()
    payload = resp.json()
    # A single `q` can come back as a bare string instead of a one-item list.
    if isinstance(payload, str):
        payload = [payload]
    if not isinstance(payload, list) or len(payload) != len(texts):
        return None
    results: list[str] = []
    for item in payload:
        if isinstance(item, str):
            results.append(item)
        elif isinstance(item, list) and item and isinstance(item[0], str):
            results.append(item[0])
        else:
            return None
    return results


def translate_via_chrome(texts: list[str], source_lang: str, target_lang: str) -> list[str] | None:
    """One result per input text, in order, or None if any part of the batch failed —
    never a partially-translated list, which would silently pair a headline with
    another headline's translation."""
    if not texts:
        return []
    results: list[str] = []
    for batch in _chrome_batches(texts):
        try:
            translated = _chrome_request(batch, source_lang, target_lang)
        except Exception:
            return None
        if translated is None:
            return None
        results.extend(translated)
    return results


def _translation_chunks(text: str, limit: int = 450) -> list[str]:
    """Split long encyclopedia prose without cutting words where possible."""
    chunks: list[str] = []
    remaining = text.strip()
    while len(remaining) > limit:
        cut = max(
            remaining.rfind(". ", 0, limit),
            remaining.rfind("? ", 0, limit),
            remaining.rfind("! ", 0, limit),
            remaining.rfind(" ", 0, limit),
        )
        if cut < limit // 2:
            cut = limit
        else:
            cut += 1
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def _translate_with_fallback(text: str, source_lang: str, target_lang: str) -> str:
    translated: list[str] = []
    for chunk in _translation_chunks(text):
        response = requests.get(
            FALLBACK_TRANSLATE_URL,
            params={"q": chunk, "langpair": f"{source_lang}|{target_lang}"},
            headers=HEADERS,
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        result = payload.get("responseData", {}).get("translatedText", "")
        if not result or payload.get("responseStatus") != 200:
            return text
        translated.append(unescape(result))
    return " ".join(translated)


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    """Returns the translation, or the original text when every transport failed —
    callers that cache the result treat "came back unchanged" as "not translated
    yet" rather than storing English under a Korean key (see company_news and
    battle.get_company_detail_cached)."""
    if not text:
        return text

    chunks = _translation_chunks(text)
    via_chrome = translate_via_chrome(chunks, source_lang, target_lang)
    if via_chrome and all(part.strip() for part in via_chrome):
        return " ".join(part.strip() for part in via_chrome)

    try:
        resp = requests.get(
            TRANSLATE_URL,
            params={"client": "gtx", "sl": source_lang, "tl": target_lang, "dt": "t", "q": text},
            headers=HEADERS,
            timeout=4,
        )
        resp.raise_for_status()
        segments = resp.json()[0]
        return "".join(seg[0] for seg in segments if seg[0])
    except Exception:
        try:
            return _translate_with_fallback(text, source_lang, target_lang)
        except Exception:
            return text


def translate_to_korean(text: str, source_lang: str = "en") -> str:
    return translate_text(text, source_lang, "ko")


def translate_to_english(text: str, source_lang: str = "ko") -> str:
    return translate_text(text, source_lang, "en")


def translate_batch_via_single_call(
    texts: list[str], source_lang: str = "ko", target_lang: str = "en"
) -> list[str] | None:
    """Joins many short texts into one request (newline-separated) instead of one
    request per text — this endpoint treats each line as its own segment, so the
    response's segments normally line up with the input lines one-for-one. Returns
    None (never raises) whenever that alignment can't be confirmed — request failure,
    or a segment count that doesn't match the input count (e.g. punctuation inside a
    name made Google merge or split lines differently than expected) — so the caller
    can fall back to translating this batch one-by-one instead of risking a silent
    name/translation mismatch."""
    if not texts:
        return []

    via_chrome = translate_via_chrome(texts, source_lang, target_lang)
    if via_chrome and all(part.strip() for part in via_chrome):
        return [part.strip() for part in via_chrome]

    try:
        resp = requests.get(
            TRANSLATE_URL,
            params={"client": "gtx", "sl": source_lang, "tl": target_lang, "dt": "t", "q": "\n".join(texts)},
            timeout=8,
        )
        resp.raise_for_status()
        segments = resp.json()[0]
    except Exception:
        return None

    if len(segments) == len(texts):
        # Each segment still carries the newline that joined it to the next input
        # line (confirmed against the live endpoint), so strip it back off.
        return [seg[0].strip() for seg in segments]

    # Google sometimes returns a different segment count than input lines but still
    # preserves the newlines within/across segment text — try reassembling and
    # re-splitting before giving up.
    lines = "".join(seg[0] for seg in segments if seg[0]).split("\n")
    return [line.strip() for line in lines] if len(lines) == len(texts) else None
