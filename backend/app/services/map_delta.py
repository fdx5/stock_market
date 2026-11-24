"""Changed-items-only refreshes for the polled US map lists (outbound bandwidth).

The S&P 500 list is ~31 KB gzipped and was fetched whole every 10 s, although outside the
regular session most of its 503 rows do not change between polls. The server remembers, per
list, a fingerprint of every row and the sequence number of the request that first saw it
change. A client that sends back the `seq` and `token` of its last response gets only the rows
changed since then plus the full ordered code list and a close-price checksum, from which it
rebuilds exactly the full response (api/client.ts mapDelta). A different process (restart,
deploy overlap) has a different token and answers in full.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading

TOKEN = secrets.token_hex(6)
_lock = threading.Lock()
_seq = 0
_rows: dict[str, dict[str, tuple[str, int]]] = {}


def _fingerprint(item: dict) -> str:
    return hashlib.blake2b(json.dumps(item, sort_keys=True, separators=(",", ":"), default=str).encode(),
                           digest_size=12).hexdigest()


def close_sum(items: list[dict]) -> float:
    total = 0.0
    for item in items:
        value = item.get("close")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            total += value
    return total


def apply(name: str, payload: dict, since: int | None, token: str | None) -> dict:
    """Record the rows of a full payload; return it whole, or as a delta against `since`."""
    global _seq
    items = payload["items"]
    with _lock:
        _seq += 1
        seq = _seq
        rows = _rows.setdefault(name, {})
        changed_at = {}
        for item in items:
            code = str(item.get("code"))
            fp = _fingerprint(item)
            held = rows.get(code)
            if held is None or held[0] != fp:
                held = (fp, seq)
                rows[code] = held
            changed_at[code] = held[1]
        if len(rows) > 4096:   # bounded: drop codes no longer listed
            listed = set(changed_at)
            for code in [c for c in rows if c not in listed]:
                del rows[code]
    out = {**payload, "delta_seq": seq, "delta_token": TOKEN}
    if since is None or token != TOKEN or since > seq:
        return out
    out["items"] = [item for item in items if changed_at[str(item.get("code"))] > since]
    out["delta"] = True
    out["codes"] = [str(item.get("code")) for item in items]
    out["close_sum"] = close_sum(items)
    return out
