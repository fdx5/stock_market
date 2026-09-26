"""Transparent, transaction-only regional leader model (v1).

No network calls and no inferred location/household data. The proposed 40:25:20
weights are normalized over the 85 points we can observe; amenity points are
not fabricated. Ranking is independent of map filters, period and page size.
"""
from bisect import bisect_left, bisect_right
from collections import defaultdict
import datetime as dt
from statistics import mean, median

MODEL = "regional-leader-v1"


def _day(date):
    return int(date.strftime("%Y%m%d"))


def _percentiles(values):
    """Midrank percentiles: ties receive identical scores; need three peers."""
    ordered = sorted(values.values())
    if len(ordered) < 3:
        return {}
    return {key: 100 * (bisect_left(ordered, val) + bisect_right(ordered, val) - 1)
            / (2 * (len(ordered) - 1)) for key, val in values.items()}


def _supported(score, peers):
    # Shrink sparse comparison groups toward neutral: being best of three
    # tiny units is weaker evidence than being best of 100 comparable units.
    return 50 + (score - 50) * peers / (peers + 10)


def evaluate(complexes: dict, today: dt.date) -> dict:
    end = _day(today)
    six = _day(today - dt.timedelta(days=183))
    year = _day(today - dt.timedelta(days=365))
    quarter = today.year * 4 + (today.month - 1) // 3
    buckets = defaultdict(dict)
    history = defaultdict(dict)
    evidence = {}
    for cid, complex_ in complexes.items():
        bands = defaultdict(list)
        for rows in complex_["types"].values():
            for row in rows:
                day, price, floor, area, direct = row
                if not direct and 0 < area and 0 < price and day <= end:
                    # Nearest 5 m²: 59.x and 60.x share a band, 59 and 84 do not.
                    bands[int((area + 2.5) // 5) * 5].append(row)
        for band, rows in bands.items():
            past = defaultdict(list)
            for day, price, _, area, _ in rows:
                q = (day // 10000) * 4 + ((day // 100 % 100) - 1) // 3
                if quarter - 8 <= q < quarter:
                    past[q].append(price / area)
            for q, prices in past.items():
                if len(prices) >= 2:
                    history[band, q][cid] = median(prices)
            annual = [r for r in rows if r[0] >= year]
            recent = [r for r in annual if r[0] >= six]
            sample = recent if len(recent) >= 3 else annual
            if len(sample) < 3 or not recent:
                continue
            buckets[band][cid] = median(r[1] / r[3] for r in sample)
            evidence[cid, band] = {
                "band": band, "sample_count": len(sample),
                "window_months": 6 if len(recent) >= 3 else 12,
                "active_months": len({r[0] // 100 for r in annual}),
                "last_trade": str(max(r[0] for r in annual)),
                "annual_count": len(annual),
            }
    historical_scores = defaultdict(list)
    historical_top = defaultdict(int)
    for (band, _), values in history.items():
        for cid, score in _percentiles(values).items():
            historical_scores[cid, band].append(_supported(score, len(values)))
            historical_top[cid, band] += score >= 90
    candidates = defaultdict(list)
    for band, values in buckets.items():
        for cid, price_score in _percentiles(values).items():
            quarters = historical_scores[cid, band]
            if len(quarters) < 2:
                continue
            info = evidence[cid, band]
            # Continuity dominates volume; volume saturates at 12/year so a
            # huge complex cannot win simply by having hundreds of sales.
            demand = 75 * min(info["active_months"], 12) / 12 + 25 * min(info["annual_count"], 12) / 12
            candidates[cid].append({**info, "peers": len(values),
                "price_score": _supported(price_score, len(values)), "persistence_score": mean(quarters),
                "demand_score": demand, "quarters": len(quarters),
                "top_quarters": historical_top[cid, band]})
    result = {}
    for cid, bands in candidates.items():
        price, persistence, demand = (mean(b[k] for b in bands) for k in
                                      ("price_score", "persistence_score", "demand_score"))
        result[cid] = {
            "score": round((40 * price + 25 * persistence + 20 * demand) / 85, 2),
            "price_score": round(price, 1), "persistence_score": round(persistence, 1),
            "demand_score": round(demand, 1), "bands": bands,
            "confidence": "high" if all(b["window_months"] == 6 and b["quarters"] >= 4
                                           and b["sample_count"] >= 5 and b["peers"] >= 10 for b in bands) else "limited",
        }
    ordered = sorted(result, key=lambda cid: (-result[cid]["score"], -result[cid]["price_score"], cid))
    for rank, cid in enumerate(ordered, 1):
        result[cid]["rank"] = rank
    return result
