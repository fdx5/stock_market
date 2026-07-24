"""What the prediction says about *itself*.

prediction_engine answers "which way, and how far". That leaves four questions a
reader has to be able to ask of any forecast before it means anything, and this
module answers them:

  방향 확률   how likely each of 상승/보합/하락 actually is, not just which one won
  신뢰도      how much the inputs justify trusting this particular row
  장 마감 설명 why the session the forecast was computed from closed the way it did
  근거 데이터  which of 주가/거래량/수급/업종지수/환율/뉴스/호가 actually fed the call

They are deliberately in one module because they share one idea: the same feature
gaps that widen the probability distribution are the ones that lower reliability and
the ones that drop an evidence category from the list. Splitting them would mean
three places deciding independently whether a missing order book matters.

Nothing here invents data. A category with no input is absent from the evidence list
rather than present-and-empty — "근거 데이터 표시" means showing what was used, and a
list padded with 해당 없음 rows would misrepresent the call as better-sourced than it is.
"""

import math

CATEGORY_PRICE = "주가"
CATEGORY_VOLUME = "거래량"
CATEGORY_FLOW = "수급"
CATEGORY_SECTOR = "업종지수"
CATEGORY_FX = "환율"
CATEGORY_NEWS = "뉴스"
CATEGORY_ORDERBOOK = "호가"

IMPACT_POSITIVE = "positive"
IMPACT_NEGATIVE = "negative"
IMPACT_NEUTRAL = "neutral"

# ---------------------------------------------------------------------------
# 1. 방향 확률
# ---------------------------------------------------------------------------

# The 보합 band: how small a move still counts as "flat". A fixed percentage would be
# wrong at both ends of the roster — 0.4% is a real move for a utility and noise for a
# semiconductor name — so it scales with the stock's own 20-day volatility, floored at
# the engine's absolute 보합 threshold so a very quiet name still gets a usable band.
#
# This same band is stored on the row and reused when the prediction is graded against
# what actually happened (prediction_grader), so a call is scored 적중 against exactly
# the definition of 보합 it was made under — not a threshold chosen later.
FLAT_BAND_MIN_PCT = 0.4
FLAT_BAND_VOL_RATIO = 0.35

# Floor on the distribution's width. Without it a stock whose 20-day realized
# volatility is near zero (a long halt, a stretch of limit-locked sessions) would
# produce a 99% probability from an arbitrarily small predicted move.
MIN_SIGMA_PCT = 0.35

# How much low reliability widens the distribution. At reliability 100 the spread is
# the stock's own volatility; at 0 it is 1.5×, which pulls every probability toward
# 33/33/33. This is the single link that makes 신뢰도 change what the reader sees
# rather than being a badge printed beside unchanged numbers.
MAX_UNCERTAINTY_WIDENING = 0.5


def _phi(z: float) -> float:
    """Standard normal CDF. math.erf keeps this dependency-free — scipy is not
    installed and would be an absurd addition for one function."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def flat_band(volatility_pct: float) -> float:
    return round(max(FLAT_BAND_MIN_PCT, float(volatility_pct) * FLAT_BAND_VOL_RATIO), 3)


def _to_whole_percent(probs: dict[str, float]) -> dict[str, int]:
    """Rounds three probabilities to integers that still sum to exactly 100.

    Largest-remainder rather than plain rounding: three independently rounded values
    routinely total 99 or 101, and a page that prints "상승 58% / 보합 27% / 하락 16%"
    invites exactly the arithmetic a reader will do.
    """
    scaled = {k: max(0.0, v) * 100 for k, v in probs.items()}
    floors = {k: int(v) for k, v in scaled.items()}
    remainder = 100 - sum(floors.values())
    order = sorted(scaled, key=lambda k: scaled[k] - floors[k], reverse=True)
    for key in order[: max(0, remainder)]:
        floors[key] += 1
    return floors


def direction_probabilities(
    move_pct: float, volatility_pct: float, band: float, reliability: float
) -> dict[str, int]:
    """P(상승) / P(보합) / P(하락) for the next session, as whole percentages.

    Models tomorrow's return as normal around the engine's point forecast, with the
    stock's own realized volatility as the spread. 보합 is the probability mass inside
    ±band; the two tails are the directional calls. That is the honest reading of what
    a point forecast plus a volatility estimate can support — anything more confident
    would be asserting precision the inputs don't carry.

    The normal assumption understates genuine tail risk (returns are fat-tailed), which
    is why this is used only to rank three coarse buckets and never to quote a
    probability of a specific price.
    """
    sigma = max(MIN_SIGMA_PCT, float(volatility_pct))
    sigma *= 1.0 + MAX_UNCERTAINTY_WIDENING * (1.0 - max(0.0, min(100.0, reliability)) / 100.0)

    p_up = 1.0 - _phi((band - move_pct) / sigma)
    p_down = _phi((-band - move_pct) / sigma)
    p_flat = max(0.0, 1.0 - p_up - p_down)
    return _to_whole_percent({"up": p_up, "flat": p_flat, "down": p_down})


# ---------------------------------------------------------------------------
# 2. 예측 신뢰도
# ---------------------------------------------------------------------------

GRADE_HIGH = "높음"
GRADE_MID = "보통"
GRADE_LOW = "낮음"

_GRADE_HIGH_MIN = 75
_GRADE_MID_MIN = 55

# Volatility expansion: today's 20-day realized vol against the preceding 60-day
# baseline. A name whose volatility has just doubled is in a regime the indicators were
# fitted on the calm part of, and its next-day distribution is wider than the recent
# window implies — the most common way a technically clean setup produces a wrong call.
_VOL_EXPANSION_SEVERE = 1.6
_VOL_EXPANSION_MILD = 1.25


def assess_reliability(payload: dict, technical: dict, ai: dict) -> dict:
    """0-100 with a grade and the specific reasons it isn't 100.

    Separate from 확신도 on purpose, and the distinction is the point of the feature:
    확신도 is how strongly the inputs lean one way, 신뢰도 is how much those inputs are
    worth. A stock with a decisive score built on a stale price, no news and a
    heuristic 60% is 확신도 강 / 신뢰도 낮음, and a reader who can't see the second
    number has no way to tell it apart from a well-sourced strong call.

    Penalties are subtractive and each carries its own note, so the returned reasons
    are exactly what produced the number rather than a post-hoc description of it.
    """
    item = payload["item"]
    score = 100.0
    notes: list[str] = []

    def penalize(points: float, note: str) -> None:
        nonlocal score
        score -= points
        notes.append(note)

    korean = item["market"] in ("KOSPI", "KOSDAQ")

    if ai.get("source") != "claude":
        penalize(15, "AI 정성 분석 대신 내장 휴리스틱으로 60% 영역을 계산함")

    headlines = payload.get("headlines") or []
    if not headlines:
        penalize(12, "최근 개별 보도가 수집되지 않아 뉴스 근거가 비어 있음")
    elif len(headlines) < 3:
        penalize(5, f"수집된 보도가 {len(headlines)}건으로 적음")

    if korean:
        if not payload.get("flows"):
            penalize(8, "외국인·기관 수급 데이터를 가져오지 못함")
        if not payload.get("orderbook"):
            penalize(6, "장 마감 호가 잔량 데이터를 가져오지 못함")
    else:
        # Not a data failure — no free per-ticker depth or investor-flow feed exists for
        # the US roster at all. It still widens the distribution (the 40% block is
        # running on chart alone), so it is recorded, but at a fraction of the penalty a
        # KRX name gets for losing data that should have been there.
        penalize(4, "미국 종목은 호가·수급 원천이 없어 차트 지표 비중이 높음")

    if not payload.get("index"):
        penalize(5, "지수 흐름 데이터를 가져오지 못함")

    bars = int(technical.get("history_bars") or 0)
    if bars < 120:
        penalize(10, f"시세 이력이 {bars}거래일로 중장기 지표를 신뢰하기 어려움")
    elif bars < 250:
        penalize(4, f"시세 이력이 {bars}거래일로 1년 미만")

    if technical.get("stale_days", 0) > 1:
        penalize(20, f"기준 종가가 {technical['stale_days']}일 지연된 데이터임")

    expansion = technical.get("vol_expansion")
    if expansion:
        if expansion >= _VOL_EXPANSION_SEVERE:
            penalize(15, f"20일 변동성이 직전 대비 {expansion:.1f}배로 확대됨")
        elif expansion >= _VOL_EXPANSION_MILD:
            penalize(8, f"20일 변동성이 직전 대비 {expansion:.2f}배로 다소 확대됨")

    tech_score = float(technical.get("score") or 0.0)
    ai_score = float(ai.get("ai_score") or 0.0)
    if tech_score * ai_score < 0 and abs(tech_score) > 0.15 and abs(ai_score) > 0.15:
        penalize(12, "정량 지표(40%)와 정성 판단(60%)이 서로 반대 방향을 가리킴")

    volume_ratio = technical.get("volume_ratio")
    if volume_ratio and volume_ratio >= 3.0:
        penalize(8, f"당일 거래량이 20일 평균의 {volume_ratio:.1f}배로 이례적임")

    score = max(0.0, min(100.0, score))
    if score >= _GRADE_HIGH_MIN:
        grade = GRADE_HIGH
    elif score >= _GRADE_MID_MIN:
        grade = GRADE_MID
    else:
        grade = GRADE_LOW

    if not notes:
        notes.append("필요한 입력 데이터가 모두 수집되었고 지표 간 충돌도 없음")

    return {"score": round(score), "grade": grade, "notes": notes}


# ---------------------------------------------------------------------------
# 3. 장 마감 가격 변화 설명
# ---------------------------------------------------------------------------

# Below this the session is described as 보합 rather than given a direction, matching
# how the page talks about a flat forecast.
_SESSION_FLAT_PCT = 0.3
# The 환율 line is dropped below this. A 0.05% notice-rate tick explains nothing, and
# listing it would violate the "only evidence actually used" rule this module exists for.
_FX_MIN_MOVE_PCT = 0.25


def _josa(word: str, with_final: str, without_final: str) -> str:
    """Korean particle agreement (은/는, 이/가) for a name whose ending we don't know
    ahead of time — the roster mixes 삼성전자, SK하이닉스 and AMD. Only Hangul carries a
    final consonant this can be read from; anything else takes the vowel-ending form,
    which is how these tickers are read aloud in Korean."""
    if not word:
        return without_final
    ch = word[-1]
    if "가" <= ch <= "힣":
        return with_final if (ord(ch) - 0xAC00) % 28 else without_final
    return without_final


def build_market_context(market: str, payloads: list[dict], index: dict | None, fx: dict | None) -> dict:
    """The same-session cross-section every stock in a market is explained against.

    Computed once per market rather than per stock because it is the same numbers for
    all of them, and because the peer average is only meaningful as a property of the
    group — "이 종목만 오른 것인지 시장이 오른 것인지" cannot be answered from one row.
    """
    changes = [
        p["technical"]["session_change_pct"]
        for p in payloads
        if p.get("technical", {}).get("session_change_pct") is not None
    ]
    peer_avg = round(sum(changes) / len(changes), 2) if changes else None

    by_sector: dict[str, list[float]] = {}
    for p in payloads:
        sector = (p["item"].get("sector") or "").strip()
        change = p.get("technical", {}).get("session_change_pct")
        if sector and change is not None:
            by_sector.setdefault(sector, []).append(change)
    sector_avg = {
        # A one-name "sector average" is that name's own move restated — it explains
        # nothing and would read as corroboration, so it needs at least two members.
        sector: round(sum(vals) / len(vals), 2)
        for sector, vals in by_sector.items()
        if len(vals) >= 2
    }

    return {
        "market": market,
        "index": index,
        "fx": fx,
        "peer_avg_change_pct": peer_avg,
        "sector_avg": sector_avg,
    }


def _session_factors(payload: dict, technical: dict, market_ctx: dict) -> list[tuple[str, float]]:
    """(문구, 방향) pairs for everything that plausibly moved this stock today.

    The sign is the factor's own direction, not its contribution — attributing a
    magnitude to each would be a claim this data can't support. The caller sorts them
    into 기여 요인 and 상쇄 요인 by comparing against the day's actual move.
    """
    item = payload["item"]
    factors: list[tuple[str, float]] = []

    index = market_ctx.get("index")
    if index:
        change = float(index.get("change_1d_pct") or 0.0)
        factors.append((f"{index['label']} 지수 {change:+.2f}%", change))

    sector = (item.get("sector") or "").strip()
    sector_avg = market_ctx.get("sector_avg", {}).get(sector)
    if sector_avg is not None:
        factors.append((f"{sector} 업종 평균 {sector_avg:+.2f}%", sector_avg))
    else:
        peer = market_ctx.get("peer_avg_change_pct")
        if peer is not None:
            factors.append((f"동일 시장 대형주 평균 {peer:+.2f}%", peer))

    flows = payload.get("flows")
    if flows:
        combined = float(flows.get("foreign_5d") or 0.0) + float(flows.get("institution_5d") or 0.0)
        if abs(combined) >= 1:
            side = "순매수" if combined > 0 else "순매도"
            factors.append((f"외국인·기관 5일 {abs(combined):,.0f}억원 {side}", combined))

    ratio = technical.get("volume_ratio")
    session_change = technical.get("session_change_pct") or 0.0
    if ratio and ratio >= 1.3:
        # Volume confirms whichever way the day closed; on its own it has no direction,
        # so it is signed by the session's own move.
        factors.append((f"거래량 20일 평균의 {ratio * 100:.0f}%", session_change))

    fx = market_ctx.get("fx")
    if fx and abs(float(fx.get("change_pct") or 0.0)) >= _FX_MIN_MOVE_PCT:
        change = float(fx["change_pct"])
        # A weaker won lifts KRX exporters' earnings translation and is read as a
        # positive for the KOSPI large caps on this roster; for a US name quoted in
        # dollars it is a valuation effect on the Korean reader's side, not on the
        # stock. Signed for KRX, listed without a direction for NASDAQ.
        direction = "상승" if change > 0 else "하락"
        signed = change if item["market"] in ("KOSPI", "KOSDAQ") else 0.0
        factors.append((f"원/달러 환율 {change:+.2f}% {direction}", signed))

    return factors


def compose_close_summary(payload: dict, technical: dict, market_ctx: dict) -> str:
    """Plain-language account of why this stock closed where it did.

    Written from the factors above plus an index/idiosyncratic split, so it answers
    "이 종목이 오른 건가, 시장이 오른 건가" with a number instead of a hedge. This is the
    deterministic version; when Claude is available its own wording replaces it (it can
    read the headlines, which is where the real explanation usually lives), and this
    stays as the value the row falls back to.
    """
    item = payload["item"]
    name = item["name"]
    change = technical.get("session_change_pct")
    if change is None:
        return f"{name}{_josa(name, '의', '의')} 당일 종가 변동을 계산할 수 있는 직전 거래일 데이터가 없습니다."

    if change >= _SESSION_FLAT_PCT:
        direction = "상승"
    elif change <= -_SESSION_FLAT_PCT:
        direction = "하락"
    else:
        direction = "보합"

    factors = _session_factors(payload, technical, market_ctx)
    aligned = [text for text, sign in factors if sign and (sign > 0) == (change > 0)]
    opposed = [text for text, sign in factors if sign and (sign > 0) != (change > 0)]

    parts = [f"{name}{_josa(name, '은', '는')} 당일 {change:+.2f}% {direction} 마감했습니다."]

    # The index/idiosyncratic split comes second, immediately after the headline number,
    # because it is the only sentence here that differs from every other card in the
    # same market. The factor list that follows is largely market-wide — the same index
    # move and the same FX tick appear on all twenty rows — and leading with it made
    # twenty cards read as twenty copies of one paragraph, with the one line that
    # distinguished them pushed past the card's line clamp.
    index = market_ctx.get("index")
    if index is not None:
        market_move = float(index.get("change_1d_pct") or 0.0)
        residual = change - market_move
        parts.append(
            f"지수 영향 {market_move:+.2f}%p를 제외한 종목 고유 변동은 {residual:+.2f}%p입니다."
        )

    if direction == "보합":
        if factors:
            parts.append(f"{', '.join(text for text, _ in factors[:3])} 등 재료가 서로 상쇄됐습니다.")
    elif aligned:
        joined = ", ".join(aligned[:3])
        parts.append(f"{joined}{_josa(aligned[2] if len(aligned) > 2 else aligned[-1], '이', '가')} {direction} 요인으로 작용했습니다.")

    if opposed and direction != "보합":
        parts.append(f"반대로 {opposed[0]}{_josa(opposed[0], '은', '는')} 상쇄 요인이었습니다.")

    return " ".join(parts)


# ---------------------------------------------------------------------------
# 4. 근거 데이터
# ---------------------------------------------------------------------------


def _impact(value: float | None) -> str:
    if value is None or abs(value) < 1e-9:
        return IMPACT_NEUTRAL
    return IMPACT_POSITIVE if value > 0 else IMPACT_NEGATIVE


def _entry(category: str, label: str, value: str, impact: str) -> dict:
    return {"category": category, "label": label, "value": value, "impact": impact}


def build_evidence(payload: dict, technical: dict, ai: dict, market_ctx: dict) -> list[dict]:
    """The inputs this specific row was actually computed from, categorized.

    Every entry corresponds to a value that entered a score. A category whose source
    returned nothing is simply absent — that absence is itself reported, through the
    reliability notes, rather than by printing an empty row here.
    """
    item = payload["item"]
    evidence: list[dict] = []

    session_change = technical.get("session_change_pct")
    if session_change is not None:
        evidence.append(
            _entry(CATEGORY_PRICE, "당일 종가 등락", f"{session_change:+.2f}%", _impact(session_change))
        )
    for group in technical.get("driver_groups", []):
        if group["group"] in ("trend", "momentum", "band") and group["texts"]:
            evidence.append(
                _entry(
                    CATEGORY_PRICE,
                    {"trend": "추세", "momentum": "모멘텀", "band": "밴드 위치"}[group["group"]],
                    " · ".join(group["texts"]),
                    _impact(group["score"]),
                )
            )
        elif group["group"] == "volume" and group["texts"]:
            evidence.append(
                _entry(CATEGORY_VOLUME, "거래량 신호", " · ".join(group["texts"]), _impact(group["score"]))
            )
        elif group["group"] == "orderbook" and group["texts"]:
            evidence.append(
                _entry(CATEGORY_ORDERBOOK, "마감 호가 잔량", " · ".join(group["texts"]), _impact(group["score"]))
            )

    flows = payload.get("flows")
    if flows:
        foreign = float(flows.get("foreign_5d") or 0.0)
        institution = float(flows.get("institution_5d") or 0.0)
        evidence.append(
            _entry(
                CATEGORY_FLOW,
                f"외국인·기관 {flows.get('days', 5)}일 순매수",
                f"외국인 {foreign:+,.0f}억 · 기관 {institution:+,.0f}억",
                _impact(foreign + institution),
            )
        )

    index = market_ctx.get("index")
    if index:
        evidence.append(
            _entry(
                CATEGORY_SECTOR,
                f"{index['label']} 지수",
                f"당일 {index['change_1d_pct']:+.2f}% · 5일 {index['change_5d_pct']:+.2f}%"
                f" ({'20일선 위' if index.get('above_ma20') else '20일선 아래'})",
                _impact(index.get("change_1d_pct")),
            )
        )
    sector = (item.get("sector") or "").strip()
    sector_avg = market_ctx.get("sector_avg", {}).get(sector)
    if sector_avg is not None:
        evidence.append(
            _entry(CATEGORY_SECTOR, f"{sector} 업종 평균", f"{sector_avg:+.2f}%", _impact(sector_avg))
        )

    fx = market_ctx.get("fx")
    if fx and abs(float(fx.get("change_pct") or 0.0)) >= _FX_MIN_MOVE_PCT:
        evidence.append(
            _entry(
                CATEGORY_FX,
                "원/달러 환율",
                f"{fx['rate']:,.1f}원 ({fx['change_pct']:+.2f}%)",
                # A weaker won reads positive for the KRX exporters on this roster and
                # carries no directional claim for a dollar-quoted US name.
                _impact(fx["change_pct"] if item["market"] in ("KOSPI", "KOSDAQ") else None),
            )
        )

    headlines = payload.get("headlines") or []
    if headlines:
        top = headlines[0].get("title", "").strip()
        evidence.append(
            _entry(
                CATEGORY_NEWS,
                f"최근 보도 {len(headlines)}건",
                top[:60] + ("…" if len(top) > 60 else ""),
                _impact(ai.get("ai_score")),
            )
        )
    # Claude's drivers are qualitative reads that no other category carries (peer
    # comparison, a supply-chain angle, why one headline outweighs three). The
    # heuristic's "drivers" are just its flow and index notes restated — already listed
    # above under 수급 and 업종지수 — so including them would print the same fact twice
    # under the wrong heading.
    if ai.get("source") == "claude":
        for driver in (ai.get("drivers") or [])[:3]:
            evidence.append(_entry(CATEGORY_NEWS, "AI 판단 포인트", str(driver), _impact(ai.get("ai_score"))))

    return evidence
