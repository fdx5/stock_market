"""Scoring: the quantitative block, and its weighted combination with the qualitative
block from ai_analyst.

## Why this block was rebuilt (2026-08)

The original version scored the chart the way a chart is normally read: price above
its moving averages, MACD widening, volume confirming — trend-following, with the
verdict leaning the way the stock had just been going. Replayed over the actual
roster (90 stocks, 3 years, 51,780 stock-days, both KRX markets and NASDAQ) every one
of those signals came out with a *negative* information coefficient against the next
session:

    trend -0.0057   momentum -0.0175   band -0.0173   volume -0.0115
    combined chart score -0.0139   (directional hit rate 49.6%)

That is not a bad month. It held in all three markets, in all four volatility
buckets, and across a 70/30 time split. The reason is visible in the same data: at a
one-day horizon this universe mean-reverts. Yesterday's move has the strongest single
relationship to tomorrow's and it is *inverted* (IC -0.028), and the same holds for
the 5-day move and for distance from the 20-day mean. The engine was pointed the
wrong way, so the 60% qualitative block was spending most of its weight correcting a
40% block that was actively subtracting information.

So the quantitative verdict is now built from the terms that measured positive out of
sample, and the classic chart readings are kept for the evidence panel — which is
what they were always genuinely good for — without steering the number. See
`_reversal_score`.

## What this does not claim

The edge is small. Out of sample the rebuilt block scores IC +0.021 and roughly 36%
on the three-way call against a 35.1% "always 상승" baseline. Next-day direction on
single stocks is close to irreducible with public daily data, and a page implying
otherwise would be lying. The point of this module is to be honestly on the right
side of zero and to say how confident it actually is — see `_confidence`, which is
now tied to the signal's own strength percentile because the previous grades measured
nothing (강 37.5% vs 약 36.1% over 362 graded live rows).
"""

import datetime as dt
import math

import pandas as pd

from app.data.prediction_universe import snap_to_tick
from app.services import ai_analyst, prediction_quality

# Inside the quantitative block. The reversal composite is the part with measured
# out-of-sample skill; the order book is a 20-minute-delayed end-of-session depth
# snapshot that no historical feed exists for, so it cannot be backtested the same
# way. It keeps a place because resting depth at the close is real information, and a
# minority weight because "cannot be validated" is a reason for restraint, not for
# exclusion.
REVERSAL_WEIGHT = 0.75
ORDERBOOK_WEIGHT = 0.25

# The headline split. Moved from 40/60 to 55/45: the quantitative block is now the
# half of the verdict that has a measured sign, and at 40% a validated signal was
# being outvoted by an unvalidated one. The qualitative block stays substantial
# because news, flows and index context carry information the price series cannot.
TECHNICAL_WEIGHT = 0.55
AI_WEIGHT = 0.45

RESULT_UP = "상승"
RESULT_DOWN = "하락"
RESULT_FLAT = "보합"

# Below this the two blocks are effectively disagreeing or both near zero, and calling
# a direction would be reading noise. Lowered from 0.12 so that the 보합 band is the
# single definition of "too small to call" — with MOVE_SCALE at 2.4 the band already
# binds at |score| 0.146, and two thresholds fighting over the same decision was how
# the old engine ended up with a 보합 rate nothing had chosen.
FLAT_SCORE_THRESHOLD = 0.08

# Scales a unit score into a percentage move via the stock's own 20-day volatility, so
# a full-conviction call on a quiet large cap predicts a smaller move than the same
# call on a volatile one.
#
# Raised from 1.2 to 2.4, which is a calibration fix rather than a confidence one. A
# directional call needs |move| > band, and band is 0.35x the same volatility, so 1.2
# required |score| > 0.292 — against a live score distribution whose standard
# deviation was 0.232. The arithmetic could only end one way: 72% of all published
# calls came out 보합 while only 31% of sessions actually were, and the 보합 rows hit
# 33.6%, which is what reading noise looks like. At 2.4 the published mix lands near
# the observed one (~68% directional) — the model now says a direction about as often
# as the market takes one.
MOVE_SCALE = 2.4

# Equities drift up, and a pure reversal signal is structurally short that drift: a
# stock in an uptrend spends most of its life above its own 20-day mean, so a model
# reading distance-from-the-mean as overextension calls 하락 on it session after
# session. Measured over the training split the roster's average day was +0.220%, and
# leaving it out showed up exactly where the arithmetic says it should — the rebuilt
# block published 36.9% 하락 against a 33.5% reality.
#
# Added as a constant rather than folded into the score because it is not a view about
# any particular stock: it is the level the whole distribution sits at, and it belongs
# where it can be read off in one line and re-measured when the regime changes.
# Centring each term on its own trailing mean was tried instead and fixed the same
# skew, but cost a quarter of the composite's information coefficient (+0.020 →
# +0.016), so the constant is what shipped.
DRIFT_PCT = 0.22
# Hard ceiling on the predicted move. KRX's daily limit is ±30% and there is no US
# equivalent, but a next-day point forecast beyond this is not a forecast — it's a
# guess, and printing one would misrepresent how much the inputs actually support.
MAX_MOVE_PCT = 8.0

DISCLAIMER = (
    "본 예측은 공개된 시세·지표·언론 데이터에 기반한 AI의 통계적 추정이며, "
    "투자 자문이나 매매 권유가 아닙니다. 투자 판단과 그 결과에 대한 책임은 투자자 본인에게 있습니다."
)


def _clip(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _trend_score(row: pd.Series) -> tuple[float, list[str]]:
    """Where price sits relative to its moving averages, and how those averages are
    stacked. Normalized to [-1, 1] by dividing by the number of checks that produced
    a verdict, so a stock too young for a 120-day average isn't penalized for it."""
    checks: list[float] = []
    drivers: list[str] = []

    close = float(row["close"])
    sma20 = row.get("sma20")
    sma60 = row.get("sma60")
    sma120 = row.get("sma120")
    sma5 = row.get("sma5")

    if pd.notna(sma20):
        above = close > float(sma20)
        checks.append(1.0 if above else -1.0)
        drivers.append(f"20일선 {'상회' if above else '하회'}")
    if pd.notna(sma5) and pd.notna(sma20):
        golden = float(sma5) > float(sma20)
        checks.append(1.0 if golden else -1.0)
        drivers.append(f"5일선 {'>' if golden else '<'} 20일선")
    if pd.notna(sma20) and pd.notna(sma60):
        checks.append(1.0 if float(sma20) > float(sma60) else -1.0)
    if pd.notna(sma60) and pd.notna(sma120):
        aligned = float(sma60) > float(sma120)
        checks.append(0.5 if aligned else -0.5)
        drivers.append(f"중기 {'정배열' if aligned else '역배열'}")

    if not checks:
        return 0.0, []
    return _clip(sum(checks) / len(checks)), drivers


def _momentum_score(row: pd.Series, prev: pd.Series) -> tuple[float, list[str]]:
    checks: list[float] = []
    drivers: list[str] = []

    hist = row.get("macd_hist")
    prev_hist = prev.get("macd_hist")
    if pd.notna(hist) and pd.notna(prev_hist):
        hist = float(hist)
        widening = hist >= float(prev_hist)
        if hist > 0:
            checks.append(1.0 if widening else 0.3)
            drivers.append(f"MACD 양(+) 히스토그램 {'확대' if widening else '축소'}")
        else:
            checks.append(-1.0 if not widening else -0.3)
            drivers.append(f"MACD 음(-) 히스토그램 {'확대' if not widening else '축소'}")

    rsi = row.get("rsi14")
    if pd.notna(rsi):
        rsi = float(rsi)
        if rsi >= 70:
            # Overbought is a warning, not a reversal call — an uptrend can hold a
            # high RSI for weeks, so this leans mildly negative rather than flipping
            # the momentum verdict outright.
            checks.append(-0.4)
            drivers.append(f"RSI {rsi:.0f} 과매수 구간")
        elif rsi <= 30:
            checks.append(0.4)
            drivers.append(f"RSI {rsi:.0f} 과매도 구간")
        else:
            checks.append((rsi - 50) / 20)
            drivers.append(f"RSI {rsi:.0f} 중립")

    if not checks:
        return 0.0, []
    return _clip(sum(checks) / len(checks)), drivers


def _band_score(row: pd.Series, trend: float) -> tuple[float, list[str]]:
    """Bollinger position, read as continuation rather than mean reversion.

    Riding the upper band inside an uptrend is strength; touching it against a
    downtrend is exhaustion. Reading %B alone would score those identically, so the
    trend sign gates the interpretation.
    """
    upper = row.get("bb_upper")
    lower = row.get("bb_lower")
    if pd.isna(upper) or pd.isna(lower):
        return 0.0, []
    width = float(upper) - float(lower)
    if width <= 0:
        return 0.0, []

    pct_b = (float(row["close"]) - float(lower)) / width
    if pct_b > 0.85:
        return (0.5, ["볼린저 상단 밴드 근접 (추세 지속)"]) if trend > 0 else (-0.5, ["볼린저 상단 이탈 (과열)"])
    if pct_b < 0.15:
        return (-0.5, ["볼린저 하단 이탈 (약세 지속)"]) if trend < 0 else (0.5, ["볼린저 하단 근접 (반등 여지)"])
    return 0.0, []


def _volume_score(df: pd.DataFrame) -> tuple[float, list[str]]:
    row = df.iloc[-1]
    prev = df.iloc[-2]
    checks: list[float] = []
    drivers: list[str] = []

    vol_ma = row.get("volume_ma20")
    if pd.notna(vol_ma) and float(vol_ma) > 0:
        ratio = float(row["volume"]) / float(vol_ma)
        if ratio > 1.3:
            # Heavy volume confirms whichever way the day closed; it isn't directional
            # on its own.
            up_day = float(row["close"]) > float(prev["close"])
            checks.append(1.0 if up_day else -1.0)
            drivers.append(f"거래량 20일 평균 대비 {ratio * 100:.0f}% ({'상승' if up_day else '하락'} 확인)")
        elif ratio < 0.6:
            checks.append(0.0)
            drivers.append(f"거래량 20일 평균의 {ratio * 100:.0f}%로 관망세")

    obv = df["obv"].tail(10)
    if len(obv) >= 10 and not obv.isna().any():
        rising = float(obv.iloc[-1]) > float(obv.iloc[0])
        checks.append(0.6 if rising else -0.6)
        drivers.append(f"OBV 10일 {'누적 매집' if rising else '누적 분산'}")

    if not checks:
        return 0.0, []
    return _clip(sum(checks) / len(checks)), drivers


def _reversal_score(df: pd.DataFrame, vol_pct: float) -> tuple[float, list[str]]:
    """The quantitative verdict: short-horizon mean reversion, in [-1, 1].

    Three horizons of "how far has this run from where it was", each divided by the
    move size that is normal *for this stock* and then inverted. Normalizing matters
    as much as the sign does — a -4% day on a utility and a -4% day on a small-cap
    semiconductor name are not the same event, and the raw percentage treats them
    alike. Each horizon is scaled by √t so a 5-day move and a 1-day move are compared
    on the same footing rather than the longer window always dominating.

    Weights are the measured ones, not chosen ones. Over the 70% training split the
    three terms scored IC -0.037 / -0.020 / -0.019 against the next session (so
    +0.037 / +0.020 / +0.019 inverted), and 0.5 / 0.3 / 0.2 is that ordering. The
    composite held at IC +0.021 on the 30% of history the weights never saw, which is
    the only number here worth trusting.

    Clipped at ±3 sigma before weighting. Without it a single limit-up day — and this
    roster had six of them in one session — would push one stock's score to an
    extreme the evidence doesn't support and drag the whole composite with it.
    """
    closes = df["close"].astype(float)
    if len(closes) < 21 or vol_pct <= 0:
        return 0.0, []

    last = float(closes.iloc[-1])
    drivers: list[str] = []
    terms: list[tuple[float, float]] = []  # (weight, z)

    prev = float(closes.iloc[-2])
    if prev > 0:
        z1 = _clip((last / prev - 1) * 100 / vol_pct, -3.0, 3.0)
        terms.append((0.5, z1))
        if abs(z1) >= 0.8:
            drivers.append(
                f"당일 {'급등' if z1 > 0 else '급락'} (평소 변동의 {abs(z1):.1f}배) → 되돌림 우위"
            )

    back5 = float(closes.iloc[-6])
    if back5 > 0:
        z5 = _clip((last / back5 - 1) * 100 / (vol_pct * math.sqrt(5)), -3.0, 3.0)
        terms.append((0.3, z5))
        if abs(z5) >= 0.8:
            drivers.append(f"5일 누적 {'과열' if z5 > 0 else '과매도'} 구간")

    sma20 = df.iloc[-1].get("sma20")
    if pd.notna(sma20) and float(sma20) > 0:
        zg = _clip((last / float(sma20) - 1) * 100 / (vol_pct * math.sqrt(20)), -3.0, 3.0)
        terms.append((0.2, zg))
        if abs(zg) >= 0.8:
            drivers.append(f"20일선 대비 {'과다 이격' if zg > 0 else '과다 하회'}")

    if not terms:
        return 0.0, []

    # Renormalized by the weight actually present, so a stock too young for a 20-day
    # mean isn't quietly scored as if that term had come out neutral.
    total_w = sum(w for w, _ in terms)
    composite = -sum(w * z for w, z in terms) / total_w

    # /2 maps the working range of the composite onto [-1, 1]: the terms are z-scores
    # clipped at 3, but a weighted blend of three of them lands inside ±2 in all but
    # a fraction of a percent of sessions.
    score = _clip(composite / 2.0)
    if not drivers:
        drivers.append("단기 과열·과매도 신호 없음 (중립)")
    return score, drivers


def _orderbook_score(orderbook: dict | None) -> tuple[float | None, list[str]]:
    """Returns None (not 0.0) when there is no book, which is how the caller knows to
    redistribute this weight instead of scoring an absent signal as neutral."""
    if not orderbook:
        return None, []
    imbalance = float(orderbook.get("imbalance", 0.0))
    touch = float(orderbook.get("touch_imbalance", 0.0))
    # Total depth sets the base read; concentration at the touch adjusts it, since a
    # book that is bid-heavy overall but thin at the best bid is weaker than the
    # totals alone suggest.
    score = _clip(imbalance * 1.5 * 0.7 + touch * 0.3)
    side = "매수" if score > 0 else "매도"
    return score, [f"호가 잔량 {side} 우위 (총잔량 불균형 {imbalance:+.1%})"]


def _volatility_expansion(closes: pd.Series) -> float | None:
    """Recent 20-session realized volatility over the 60 sessions before it.

    A ratio above 1 means the stock has moved into a noisier regime than the one the
    indicators were computed across, which is the most common way a technically clean
    setup produces a wrong next-day call. Needs the full 80 sessions — a ratio taken
    against a stub baseline is noise measuring noise.
    """
    returns = closes.pct_change().dropna()
    if len(returns) < 80:
        return None
    recent = float(returns.tail(20).std())
    baseline = float(returns.tail(80).head(60).std())
    if not baseline or baseline <= 0 or recent <= 0:
        return None
    return round(recent / baseline, 3)


def compute_technical(features: dict, session: dt.date | None = None) -> dict:
    """The quantitative block for one stock, plus the plain-language pieces the rationale and
    the UI both read from.

    Also reports the session's own numbers (today's move, volume ratio, volatility
    regime, how much history was available). Those aren't scored here — they are what
    prediction_quality needs to explain the close, judge reliability and list the
    evidence, and they are read off the same frame the scoring used, so the explanation
    can never describe a different bar than the one the call was made from.
    """
    df = features["indicators"]
    clean = df.dropna(subset=["sma20", "rsi14", "macd_hist"])
    if len(clean) < 2:
        clean = df.tail(2)

    row = clean.iloc[-1]
    prev = clean.iloc[-2]

    trend, trend_drivers = _trend_score(row)
    momentum, momentum_drivers = _momentum_score(row, prev)
    band, band_drivers = _band_score(row, trend)
    volume, volume_drivers = _volume_score(clean)

    # The classic chart reading, kept whole — but as description, not as verdict. It
    # is what the evidence panel and the AI prompt need in order to say what the chart
    # looks like, and it measured negative against the next session (see the module
    # docstring), so it no longer steers the number. Reported as `chart_score` for the
    # debug payload and the UI exactly as before.
    chart = _clip(trend * 0.40 + momentum * 0.30 + band * 0.15 + volume * 0.15)

    volatility = row.get("volatility20")
    volatility_pct = (
        float(volatility) * 100 if pd.notna(volatility) and float(volatility) > 0 else 1.8
    )

    reversal, reversal_drivers = _reversal_score(clean, volatility_pct)

    book_score, book_drivers = _orderbook_score(features.get("orderbook"))
    if book_score is None:
        # No depth feed for this name (every US ticker, and any KRX name whose ladder
        # failed to scrape). The reversal block absorbs the full weight rather than the
        # missing signal being scored as neutral, which would silently dampen every US
        # call toward zero relative to a comparable KRX one.
        technical = reversal
        book_note = "호가 데이터 미제공 (단기 반전 지표에 가중치 재배분)"
    else:
        technical = _clip(reversal * REVERSAL_WEIGHT + book_score * ORDERBOOK_WEIGHT)
        book_note = None

    drivers = [
        *reversal_drivers,
        *trend_drivers,
        *momentum_drivers,
        *band_drivers,
        *volume_drivers,
        *book_drivers,
    ]
    if book_note:
        drivers.append(book_note)

    if technical > 0.3:
        summary = "단기 과매도에 따른 반등 우위"
    elif technical > 0.1:
        summary = "완만한 반등 우위이나 신호 강도는 제한적"
    elif technical > -0.1:
        summary = "방향성 신호가 상쇄되어 중립"
    elif technical > -0.3:
        summary = "완만한 되돌림(하락) 우위"
    else:
        summary = "단기 과열에 따른 되돌림 우위"

    prev_close = float(prev["close"])
    session_change_pct = round((float(row["close"]) / prev_close - 1) * 100, 3) if prev_close else None

    vol_ma = row.get("volume_ma20")
    volume_ratio = (
        round(float(row["volume"]) / float(vol_ma), 3)
        if pd.notna(vol_ma) and float(vol_ma) > 0
        else None
    )

    as_of = str(row["date"])
    stale_days = 0
    if session is not None:
        try:
            stale_days = max(0, (session - dt.datetime.strptime(as_of, "%Y-%m-%d").date()).days)
        except (ValueError, TypeError):
            stale_days = 0

    return {
        "score": round(technical, 3),
        "chart_score": round(chart, 3),
        "orderbook_score": round(book_score, 3) if book_score is not None else None,
        "summary": summary,
        "drivers": drivers,
        # The same signals, kept grouped by which sub-score they came from. `drivers` is
        # the flat list the AI prompt reads; this is what lets the evidence panel say
        # *which* category a signal belongs to and whether that category leaned up or
        # down, without parsing the Korean text back apart.
        "reversal_score": round(reversal, 3),
        "driver_groups": [
            {"group": "reversal", "score": round(reversal, 3), "texts": reversal_drivers},
            {"group": "trend", "score": round(trend, 3), "texts": trend_drivers},
            {"group": "momentum", "score": round(momentum, 3), "texts": momentum_drivers},
            {"group": "band", "score": round(band, 3), "texts": band_drivers},
            {"group": "volume", "score": round(volume, 3), "texts": volume_drivers},
            {
                "group": "orderbook",
                "score": round(book_score, 3) if book_score is not None else 0.0,
                "texts": book_drivers,
            },
        ],
        "close": round(float(row["close"]), 4),
        "prev_close": round(prev_close, 4),
        "session_change_pct": session_change_pct,
        "volume_ratio": volume_ratio,
        "vol_expansion": _volatility_expansion(clean["close"]),
        "history_bars": len(df),
        "stale_days": stale_days,
        "as_of": as_of,
        "volatility_pct": round(volatility_pct, 3),
    }


def _decide(total: float, volatility_pct: float, band: float) -> tuple[str, float]:
    """(direction, expected move %) from the combined score.

    Direction is decided from the *predicted move*, not the raw score, so the two can
    never disagree on the page — a row that says 상승 always carries a positive
    증감률.

    `band` is the same 보합 threshold the probabilities are integrated over and the
    grader later scores against (prediction_quality.flat_band), and it has to be: an
    earlier version called 상승 at a fixed +0.4% while grading treated anything inside
    ±2.1% as 보합 on a volatile name, so those rows were counted wrong before the
    session even opened. One definition of 보합, used by the call, the distribution and
    the grade alike.
    """
    move = total * volatility_pct * MOVE_SCALE + DRIFT_PCT
    move = max(-MAX_MOVE_PCT, min(MAX_MOVE_PCT, move))

    if abs(total) < FLAT_SCORE_THRESHOLD or abs(move) < band:
        return RESULT_FLAT, round(move, 2)
    return (RESULT_UP if move > 0 else RESULT_DOWN), round(move, 2)


# Where the combined score has to sit before the call is worth calling confident.
# Set from the backtest's selective-prediction curve rather than from taste: taking
# only the strongest ~20% of signals lifted the three-way hit rate from 34.3% to
# 36.8%, and below roughly the top third the curve is flat. These are the score
# magnitudes that bracket that region.
CONFIDENCE_STRONG = 0.42
CONFIDENCE_MEDIUM = 0.24


def _confidence(total: float, technical: float, ai_score: float) -> str:
    """Strength of the call, discounted when the two blocks disagree.

    Agreement is the real signal: a +0.5 total built from two blocks that both lean up
    deserves more confidence than the same +0.5 built from a strongly bullish chart
    fighting clearly bad news. Without this the page would show identical conviction
    for two very different situations.

    The thresholds come from the backtest because the old ones described nothing: over
    362 graded live rows 강 hit 37.5%, 중 33.1% and 약 36.1%, which is a label that
    cost a reader attention and returned no information. A grade here has to track the
    one thing measurement says separates a better call from a worse one — how far the
    signal is from zero.
    """
    magnitude = abs(total)
    same_side = (technical >= 0) == (ai_score >= 0)
    if magnitude >= CONFIDENCE_STRONG and same_side:
        return "강"
    if magnitude >= CONFIDENCE_MEDIUM:
        return "중" if same_side else "약"
    return "약"


def _compose_detail(item: dict, technical: dict, ai: dict, result: str, move_pct: float) -> str:
    """The stored 판단 근거.

    When Claude wrote the rationale it is used as-is (it already had the technical
    block in front of it and reads better than anything assembled from fragments here);
    the heuristic path already produced its own composed text. Either way the direction
    and the number are appended, so the text can never drift from the row it explains.
    """
    base = (ai.get("detail") or "").strip()
    verdict = f" [익일 전망: {result} {move_pct:+.2f}%]"
    if not base:
        base = f"{item['name']} 정량 지표는 {technical['summary']}."
    combined = base if base.endswith(verdict) else f"{base}{verdict}"
    return ai_analyst._truncate(combined)


def build_prediction(
    features: dict,
    technical: dict,
    ai: dict,
    collect_date: str,
    predict_date: str,
    now_iso: str,
    market_ctx: dict | None = None,
) -> dict:
    """One finished row, ready for prediction_store."""
    item = features["item"]
    ai_score = float(ai.get("ai_score", 0.0))
    total = _clip(technical["score"] * TECHNICAL_WEIGHT + ai_score * AI_WEIGHT)

    band = prediction_quality.flat_band(technical["volatility_pct"])
    result, move_pct = _decide(total, technical["volatility_pct"], band)
    base_price = technical["close"]

    # Snapped to the market's own 호가 단위 — 삼성전자 quotes in 500원 steps and a
    # 2,000원 name in 1원 steps, so a raw multiplication produces a price that could
    # never be entered as an order. See prediction_universe.snap_to_tick.
    predict_price = snap_to_tick(base_price * (1 + move_pct / 100), item["market"])
    # ...and the stored 증감률 is then re-derived from the price that will actually be
    # displayed, so 기준 종가 → 예측 시세 → 증감률 all agree on the card. The rounding
    # is far smaller than the 보합 band (at most half a tick, ~0.1%, against a band of
    # 0.4% or more), so it can never move a row across a direction boundary.
    if base_price:
        move_pct = round((predict_price / base_price - 1) * 100, 2)

    ctx = market_ctx or {}
    # Reliability is computed before the probabilities because it *is* one of their
    # inputs — a call built on thin data gets a wider distribution, not the same
    # distribution with a warning label beside it.
    reliability = prediction_quality.assess_reliability(features, technical, ai)
    probabilities = prediction_quality.direction_probabilities(
        move_pct, technical["volatility_pct"], band, reliability["score"]
    )

    # Claude writes the close explanation when it ran: it has the headlines in front of
    # it, and the reason a stock moved is usually in the news rather than in the
    # numbers. The composed version is the fallback and always exists, so the field is
    # never empty regardless of which analyst path produced the 60%.
    close_summary = (ai.get("close_summary") or "").strip()
    if not close_summary:
        close_summary = prediction_quality.compose_close_summary(features, technical, ctx)

    return {
        "collect_date": collect_date,
        "predict_date": predict_date,
        "code": item["code"],
        "name": item["name"],
        "market": item["market"],
        "result": result,
        "base_price": base_price,
        "predict_price": float(predict_price),
        "change_rate": move_pct,
        "score": round(total, 3),
        "confidence": _confidence(total, technical["score"], ai_score),
        "detail": _compose_detail(item, technical, ai, result, move_pct),
        "prob_up": probabilities["up"],
        "prob_flat": probabilities["flat"],
        "prob_down": probabilities["down"],
        "flat_band": band,
        "reliability": reliability["score"],
        "reliability_grade": reliability["grade"],
        "reliability_notes": reliability["notes"],
        "close_change_rate": technical.get("session_change_pct"),
        "close_summary": ai_analyst._truncate(close_summary),
        "evidence": prediction_quality.build_evidence(features, technical, ai, ctx),
        # For KRX this is 시가총액 in won; for NASDAQ it is index weight, which is a
        # cap-share proxy (see prediction_universe._load_nasdaq_roster). Comparable
        # within a market — which is all the page needs, since it sorts inside each
        # market group — but not across the two.
        "market_cap": item.get("market_cap"),
        "created_at": now_iso,
        "updated_at": now_iso,
        # Not persisted — carried on the in-memory row so the batch's response can
        # show an operator exactly how a verdict was reached without a second query.
        "_debug": {
            "technical_score": technical["score"],
            "chart_score": technical["chart_score"],
            "orderbook_score": technical["orderbook_score"],
            "ai_score": round(ai_score, 3),
            "ai_source": ai.get("source"),
            "technical_drivers": technical["drivers"],
            "ai_drivers": ai.get("drivers", []),
            "as_of": technical["as_of"],
            "reliability": reliability["score"],
            "reliability_grade": reliability["grade"],
            "probabilities": probabilities,
        },
    }


def stale_note(session: dt.date, as_of: str) -> str | None:
    try:
        last = dt.datetime.strptime(as_of, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    gap = (session - last).days
    return f"기준 시세가 {as_of} 종가로 {gap}일 지연됨" if gap > 4 else None
