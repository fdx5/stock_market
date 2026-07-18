from app.services.battle import get_global_top20_cached


def get_fight_pair(code_a: str, code_b: str) -> dict | None:
    """Looks up two arbitrary companies from the same live-adjusted TOP20 roster used
    by the fixed samsung-vs-skhynix battle page, instead of a new fetcher — the roster
    the user picks 1P/2P from is exactly this list, so their post-selection status
    should reflect the same numbers they saw on the select screen."""
    items = get_global_top20_cached()
    by_code = {it["code"]: it for it in items if it.get("code")}
    a = by_code.get(code_a)
    b = by_code.get(code_b)
    if not a or not b:
        return None
    return {"a": a, "b": b}
