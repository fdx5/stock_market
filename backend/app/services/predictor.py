import pandas as pd

DISCLAIMER = (
    "본 예측은 과거 가격/거래량 데이터에 기반한 통계적 추정치이며 투자 조언이나 "
    "매수·매도 권유가 아닙니다. 실제 투자 결정과 그 결과에 대한 책임은 투자자 본인에게 있습니다."
)


def _trend_score(row: pd.Series) -> float:
    score = 0.0
    score += 1 if row["close"] > row["sma20"] else -1
    score += 1 if row["sma5"] > row["sma20"] else -1
    score += 1 if row["sma20"] > row["sma60"] else -1
    return score


def _momentum_score(row: pd.Series, prev_row: pd.Series) -> float:
    score = 0.0
    rsi = row["rsi14"]
    if rsi > 70:
        score -= 1
    elif rsi < 30:
        score += 1
    elif rsi >= 50:
        score += 1
    else:
        score -= 1

    if row["macd_hist"] > 0 and row["macd_hist"] >= prev_row["macd_hist"]:
        score += 1
    elif row["macd_hist"] < 0 and row["macd_hist"] <= prev_row["macd_hist"]:
        score -= 1
    return score


def _volatility_adjustment(row: pd.Series, trend_score: float) -> float:
    band_width = row["bb_upper"] - row["bb_lower"]
    if not band_width or pd.isna(band_width) or band_width == 0:
        return 0.0
    pct_b = (row["close"] - row["bb_lower"]) / band_width
    if pct_b > 0.8 and trend_score > 0:
        return 0.5
    if pct_b < 0.2 and trend_score < 0:
        return -0.5
    return 0.0


def _volume_score(row: pd.Series, prev_row: pd.Series, recent_obv: pd.Series) -> float:
    score = 0.0
    volume_ma20 = row["volume_ma20"]
    if volume_ma20 and not pd.isna(volume_ma20) and volume_ma20 > 0:
        ratio = row["volume"] / volume_ma20
        if ratio > 1.2:
            score += 1 if row["close"] > prev_row["close"] else -1

    if len(recent_obv) >= 2 and not recent_obv.isna().any():
        score += 0.5 if recent_obv.iloc[-1] > recent_obv.iloc[0] else -0.5
    return score


def _direction_and_confidence(score: float) -> tuple[str, str]:
    if score > 1.5:
        direction = "상승"
    elif score < -1.5:
        direction = "하락"
    else:
        direction = "보합"

    abs_score = abs(score)
    if abs_score >= 4:
        confidence = "강"
    elif abs_score >= 2:
        confidence = "중"
    else:
        confidence = "약"
    return direction, confidence


def _build_reasoning(row: pd.Series, prev_row: pd.Series) -> list[str]:
    reasons = []

    trend_word = "위" if row["close"] > row["sma20"] else "아래"
    reasons.append(
        f"현재가 {row['close']:,.0f}원이 20일 이동평균 {row['sma20']:,.0f}원 {trend_word}에 위치"
    )

    if row["sma5"] > row["sma20"] > row["sma60"]:
        reasons.append("5일선 > 20일선 > 60일선 정배열로 단·중기 상승 추세 유지")
    elif row["sma5"] < row["sma20"] < row["sma60"]:
        reasons.append("5일선 < 20일선 < 60일선 역배열로 단·중기 하락 추세 유지")

    rsi = row["rsi14"]
    if rsi > 70:
        reasons.append(f"RSI(14) {rsi:.1f}로 과매수 구간, 단기 조정 가능성 유의")
    elif rsi < 30:
        reasons.append(f"RSI(14) {rsi:.1f}로 과매도 구간, 기술적 반등 가능성")
    else:
        reasons.append(f"RSI(14) {rsi:.1f}로 중립 구간")

    hist_word = "확대" if row["macd_hist"] >= prev_row["macd_hist"] else "축소"
    macd_bias = "양(+)의 모멘텀" if row["macd_hist"] > 0 else "음(-)의 모멘텀"
    reasons.append(f"MACD 히스토그램이 {macd_bias} 상태에서 {hist_word} 중")

    volume_ma20 = row["volume_ma20"]
    if volume_ma20 and not pd.isna(volume_ma20) and volume_ma20 > 0:
        ratio_pct = row["volume"] / volume_ma20 * 100
        reasons.append(f"거래량이 20일 평균 대비 {ratio_pct:.0f}% 수준")

    return reasons


def _build_outlook(direction: str, confidence: str) -> dict:
    tone = {
        "상승": "우상향",
        "하락": "우하향",
        "보합": "횡보",
    }[direction]

    short_term = f"기술적 지표 종합상 단기(1주) 흐름은 {tone} 가능성에 무게가 실리며 신뢰도는 '{confidence}' 수준입니다."
    mid_term = (
        "다만 중기(1개월) 관점에서는 추세 지속 여부를 이동평균·거래량 흐름과 함께 재확인할 필요가 있으며, "
        "시장 전반의 수급 및 이슈에 따라 방향이 바뀔 수 있습니다."
    )
    return {"short_term": short_term, "mid_term": mid_term}


def predict_next_day(indicator_df: pd.DataFrame) -> dict:
    """Rule-based next-day prediction from the latest two rows of an indicator dataframe."""
    clean_df = indicator_df.dropna(
        subset=["sma60", "macd_hist", "rsi14", "bb_upper", "bb_lower", "volatility20"]
    )
    if len(clean_df) < 2:
        raise ValueError("Not enough history to compute a prediction")

    row = clean_df.iloc[-1]
    prev_row = clean_df.iloc[-2]
    recent_obv = clean_df["obv"].tail(5)

    trend_score = _trend_score(row)
    momentum_score = _momentum_score(row, prev_row)
    vol_adj = _volatility_adjustment(row, trend_score)
    volume_score = _volume_score(row, prev_row, recent_obv)

    total_score = trend_score + momentum_score + vol_adj + volume_score
    direction, confidence = _direction_and_confidence(total_score)

    last_close = float(row["close"])
    volatility = row["volatility20"]
    volatility = float(volatility) if not pd.isna(volatility) and volatility > 0 else 0.02

    sigma_move = last_close * volatility
    bias = last_close * volatility * (total_score / 7)
    predicted_center = last_close + bias
    predicted_low = round(predicted_center - sigma_move)
    predicted_high = round(predicted_center + sigma_move)
    predicted_center = round(predicted_center)

    return {
        "direction": direction,
        "confidence": confidence,
        "score": round(total_score, 2),
        "last_close": round(last_close),
        "predicted_price": predicted_center,
        "predicted_range": {"low": min(predicted_low, predicted_high), "high": max(predicted_low, predicted_high)},
        "reasoning": _build_reasoning(row, prev_row),
        "outlook": _build_outlook(direction, confidence),
        "disclaimer": DISCLAIMER,
    }
