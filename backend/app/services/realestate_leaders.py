"""Regional leaders v2: established and provisional candidates on one scale.

No network calls and no inferred location/household data. The proposed 40:25:20
weights are normalized over the 85 points we can observe; amenity points are
not fabricated. Ranking is independent of map filters, period and page size.
"""
from bisect import bisect_left, bisect_right
from collections import defaultdict
import datetime as dt
import math
from statistics import mean, median

MODEL = "regional-leader-v2"


def _day(date):
    return int(date.strftime("%Y%m%d"))


def _percentiles(values):
    """Midrank percentiles: ties receive identical scores; need two peers."""
    ordered = sorted(values.values())
    if len(ordered) < 2:
        return {}
    return {key: 100 * (bisect_left(ordered, val) + bisect_right(ordered, val) - 1)
            / (2 * (len(ordered) - 1)) for key, val in values.items()}


def _supported(score, peers):
    # Shrink sparse comparison groups toward neutral: being best of three
    # tiny units is weaker evidence than being best of 100 comparable units.
    return 50 + (score - 50) * peers / (peers + 10)


def select_reference(rows, today):
    """Fresh brokers, fresh direct, older brokers, older direct. Never mix them.

    Older brokers must not mask newer direct transactions forever. A single
    observation is retained as evidence, not treated as a reliable market price.
    """
    end, six, year = (_day(today), _day(today - dt.timedelta(days=183)), _day(today - dt.timedelta(days=365)))
    annual = [r for r in rows if year <= r[0] <= end and r[1] > 0 and r[3] > 0
              and math.isfinite(r[1]) and math.isfinite(r[3])]
    for start, direct in ((six, False), (six, True), (year, False), (year, True)):
        sample = [r for r in annual if r[0] >= start and bool(r[4]) == direct]
        if sample:
            # Expand within the same source, never substitute another source.
            if len(sample) < 3:
                sample = [r for r in annual if bool(r[4]) == direct]
            return sample, annual, direct
    return [], annual, False


def evaluate(complexes: dict, today: dt.date) -> dict:
    end = _day(today)
    six = _day(today - dt.timedelta(days=183))
    year = _day(today - dt.timedelta(days=365))
    quarter = today.year * 4 + (today.month - 1) // 3
    buckets = defaultdict(dict)
    history = defaultdict(dict)
    evidence = {}
    unranked = {}
    for cid, complex_ in complexes.items():
        bands = defaultdict(list)
        for area_key, rows in complex_["types"].items():
            for row in rows:
                day, price, floor, area, direct = row
                if 0 < area and 0 < price and math.isfinite(area) and math.isfinite(price) and day <= end:
                    # Nearest 5 m²: 59.x and 60.x share a band, 59 and 84 do not.
                    band = int((area + 2.5) // 5) * 5
                    source = complex_.get("type_sources", {}).get(area_key, "sale")
                    bands[band, source].append(row)
        selected = {}
        for (band, source), rows in bands.items():
            sample, annual, direct = select_reference(rows, today)
            if not sample:
                continue
            priority = (max(r[0] for r in sample) >= six, not direct, source == "sale")
            if band not in selected or priority > selected[band][0]:
                selected[band] = (priority, source, rows, sample, annual, direct)
        unranked[cid] = "최근 1년 유효 가격 자료 없음" if not selected else "비슷한 면적의 비교 단지 부족"
        for band, (_, source, rows, sample, annual, direct) in selected.items():
            past = defaultdict(list)
            for day, price, _, area, is_direct in rows:
                q = (day // 10000) * 4 + ((day // 100 % 100) - 1) // 3
                if not is_direct and source == "sale" and quarter - 8 <= q < quarter:
                    past[q].append(price / area)
            for q, prices in past.items():
                if len(prices) >= 2:
                    history[band, q][cid] = median(prices)
            buckets[band][cid] = median(r[1] / r[3] for r in sample)
            basis_rows = [r for r in annual if bool(r[4]) == direct]
            evidence[cid, band] = {
                "band": band, "sample_count": len(sample),
                "window_months": 6 if min(r[0] for r in sample) >= six else 12,
                "active_months": len({r[0] // 100 for r in basis_rows}),
                "last_trade": dt.datetime.strptime(str(max(r[0] for r in sample)), "%Y%m%d").date().isoformat(),
                "annual_count": len(basis_rows), "source": source,
                "price_basis": "direct" if direct else "brokered",
                "price_per_m2": round(buckets[band][cid], 4),
                "stale": max(r[0] for r in sample) < six,
            }
    historical_scores = defaultdict(list)
    historical_top = defaultdict(int)
    for (band, _), values in history.items():
        for cid, score in _percentiles(values).items():
            historical_scores[cid, band].append(_supported(score, len(values)))
            historical_top[cid, band] += score >= 90
    candidates = defaultdict(list)
    for band, values in buckets.items():
        # A narrow adjacent band is preferable to silently excluding uncommon
        # types. At most 10% area difference; one closest observation per complex.
        peers = dict(values)
        if len(peers) < 3:
            for other in sorted(buckets, key=lambda b: (abs(b - band), b)):
                if other != band and abs(other - band) <= band * .1:
                    for cid, price in buckets[other].items():
                        peers.setdefault(cid, price)
        for cid, price_score in _percentiles(peers).items():
            if cid not in values:
                continue
            quarters = historical_scores[cid, band]
            info = evidence[cid, band]
            # Continuity dominates volume; volume saturates at 12/year so a
            # huge complex cannot win simply by having hundreds of sales.
            demand = 75 * min(info["active_months"], 12) / 12 + 25 * min(info["annual_count"], 12) / 12
            established = (info["source"] == "sale" and info["price_basis"] == "brokered"
                           and info["sample_count"] >= 3 and not info["stale"] and len(quarters) >= 2)
            reliability = min(1.0, info["sample_count"] / 3) if info["sample_count"] >= 2 else .5
            if info["price_basis"] == "direct":
                reliability *= .6
            if info["source"] == "rights":
                reliability *= .85
            if info["stale"]:
                reliability *= .5
            observed_price = _supported(price_score, len(peers))
            candidates[cid].append({**info, "peers": len(peers), "expanded_comparison": len(peers) > len(values),
                "price_score": 50 + (observed_price - 50) * reliability,
                "persistence_score": mean(quarters) if len(quarters) >= 2 and info["price_basis"] == "brokered" else None,
                "demand_score": demand if established else None, "quarters": len(quarters), "established": established,
                "top_quarters": historical_top[cid, band]})
    result = {}
    for cid, bands in candidates.items():
        # Every candidate uses the same denominator. Missing history gets a
        # neutral prior of 50, never zero or a price-only 100-point rescale.
        price, persistence, demand = (mean(b[k] if b[k] is not None else 50 for b in bands) for k in
                                      ("price_score", "persistence_score", "demand_score"))
        result[cid] = {
            "score": round((40 * price + 25 * persistence + 20 * demand) / 85, 2),
            "price_score": round(price, 1), "persistence_score": round(persistence, 1),
            "demand_score": round(demand, 1), "bands": bands,
            "status": "established" if all(b["established"] for b in bands) else "provisional",
            "reasons": sorted({reason for b in bands for reason, applies in (
                ("직거래 참고가격", b["price_basis"] == "direct"), ("분양·입주권 거래 기준", b["source"] == "rights"),
                ("거래 표본 3건 미만", b["sample_count"] < 3), ("과거 비교 이력 부족", b["quarters"] < 2),
                ("최근 6개월 거래 없음", b["stale"]), ("인접 면적군으로 비교 확대", b["expanded_comparison"]),
                ("관측되지 않은 지속성·수요는 중립 50점 적용", b["persistence_score"] is None or b["demand_score"] is None)
            ) if applies}),
            "confidence": "high" if all(b["window_months"] == 6 and b["quarters"] >= 4
                                           and b["sample_count"] >= 5 and b["peers"] >= 10 and b["established"] for b in bands) else "limited",
        }
    ordered = sorted(result, key=lambda cid: (-result[cid]["score"], -result[cid]["price_score"], cid))
    for rank, cid in enumerate(ordered, 1):
        result[cid]["rank"] = rank
    for cid, reason in unranked.items():
        if cid not in result:
            result[cid] = {"rank": None, "score": None, "price_score": None, "persistence_score": None,
                           "demand_score": None, "bands": [], "status": "unranked", "confidence": "limited", "reasons": [reason]}
    return result
