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
