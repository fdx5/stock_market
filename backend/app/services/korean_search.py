"""Matching a Korean company name the way a Korean keyboard actually produces one.

"삼성전자" is four keystroke groups, and a reader halfway through typing it has produced
"ㅅ", then "사", then "삼", then "삼ㅅ" — none of which a plain substring test matches
against the finished name. The one that matters most is the pure-초성 form: typing
ㅅㅅㅈㅈ is how people search for 삼성전자 without composing a single syllable, and it is
what "초성 검색" means on every Korean site.

The whole trick is that a Hangul syllable is arithmetic, not a lookup table. U+AC00 is
가, and every syllable after it is ordered 초성 × 21 × 28, so the leading consonant of
any syllable is `(code - 0xAC00) // 588`.

Three query shapes have to work, and one matcher handles all three because it compares
character by character rather than switching on the query as a whole:

    삼성      full syllables, matched literally
    ㅅㅅㅈㅈ   초성 only, each matching that position's leading consonant
    삼ㅈ      mixed — the state a query passes through on the way to being typed

`ㅅ` matching `삼` is what makes the third case work, and it falls out of the same rule
as the second rather than needing a case of its own.
"""

from __future__ import annotations

HANGUL_BASE = 0xAC00
HANGUL_LAST = 0xD7A3
# Syllables per 초성: 21 vowels × 28 final-consonant slots (including "none").
SYLLABLES_PER_LEAD = 588

# Compatibility jamo, in 초성 order — the characters a Korean IME emits for a lone
# consonant, which is what arrives here when someone types ㅅㅅㅈㅈ.
LEADS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"


def lead_of(ch: str) -> str | None:
    """The 초성 of a composed Hangul syllable, or None for anything else."""
    code = ord(ch)
    if HANGUL_BASE <= code <= HANGUL_LAST:
        return LEADS[(code - HANGUL_BASE) // SYLLABLES_PER_LEAD]
    return None


def is_lead_jamo(ch: str) -> bool:
    """True for a standalone consonant like ㅅ — a 초성 typed on its own."""
    return ch in LEADS


def _char_matches(query_ch: str, target_ch: str) -> bool:
    if is_lead_jamo(query_ch):
        # A lone consonant matches a syllable beginning with it (ㅅ → 삼), and also
        # matches itself, for a name that literally contains a bare jamo.
        return lead_of(target_ch) == query_ch or target_ch == query_ch
    return query_ch == target_ch


def matches(query: str, text: str) -> bool:
    """Whether `query` occurs in `text`, treating a lone 초성 as any syllable it leads.

    A substring test, not a prefix one: 하이닉스 should be findable by typing 하이 even
    though the name is SK하이닉스, and 초성 queries are used the same way.
    """
    query = query.strip().lower()
    if not query:
        return True
    text = text.lower()
    if len(query) > len(text):
        return False
    # Fast path: no jamo in the query means this is an ordinary substring test, and
    # Python's own is far quicker than walking it here.
    if not any(is_lead_jamo(ch) for ch in query):
        return query in text

    span = len(text) - len(query)
    for start in range(span + 1):
        if all(_char_matches(query[i], text[start + i]) for i in range(len(query))):
            return True
    return False


def matches_any(query: str, *fields: str | None) -> bool:
    """True when `query` matches any of the given fields — a name, a Korean rendering
    of it, a ticker. Empty fields are skipped rather than treated as a match."""
    query = query.strip()
    if not query:
        return True
    return any(matches(query, field) for field in fields if field)
