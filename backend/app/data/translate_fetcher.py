import requests

# Unofficial but widely used no-auth endpoint for short, occasional translations —
# no API key/quota setup needed for a feature this small.
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    if not text:
        return text
    try:
        resp = requests.get(
            TRANSLATE_URL,
            params={"client": "gtx", "sl": source_lang, "tl": target_lang, "dt": "t", "q": text},
            timeout=4,
        )
        resp.raise_for_status()
        segments = resp.json()[0]
        return "".join(seg[0] for seg in segments if seg[0])
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
