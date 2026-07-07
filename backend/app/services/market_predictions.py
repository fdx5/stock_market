import datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo

from app.data import price_fetcher
from app.data.universe import get_top_market_cap
from app.services import prediction_store
from app.services.indicators import compute_indicators
from app.services.predictor import predict_next_day

KST = ZoneInfo("Asia/Seoul")
FLAT_THRESHOLD_PCT = 0.05


def today_kst() -> str:
    return dt.datetime.now(KST).strftime("%Y-%m-%d")


def _predict_one(code: str, name: str) -> dict | None:
    try:
        df = price_fetcher.get_history(code, years=1)
        indicator_df = compute_indicators(df)
        result = predict_next_day(indicator_df)
    except Exception:
        return None
    return {
        "code": code,
        "name": name,
        "direction": result["direction"],
        "confidence": result["confidence"],
        "score": result["score"],
        "last_close": result["last_close"],
    }


def get_today_top100_predictions() -> list[dict]:
    """Top 100 KOSPI names by market cap with a direction call for the next session,
    generated once per KST calendar day (from the latest available close) and cached
    to disk so the list stays stable through the trading day and feeds history grading.
    """
    date = today_kst()
    universe = get_top_market_cap(100)
    stored = prediction_store.get_predictions_for_date(date)

    missing = [item for item in universe if item["code"] not in stored]
    if missing:
        computed: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {pool.submit(_predict_one, item["code"], item["name"]): item for item in missing}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    computed[result["code"]] = result
        if computed:
            prediction_store.save_predictions(date, computed)
            stored.update(computed)

    items = []
    for rank, entry in enumerate(universe, start=1):
        record = stored.get(entry["code"])
        if not record:
            continue
        items.append({**record, "rank": rank, "date": date})
    return items


def _actual_direction(change_pct: float) -> str:
    if change_pct > FLAT_THRESHOLD_PCT:
        return "상승"
    if change_pct < -FLAT_THRESHOLD_PCT:
        return "하락"
    return "보합"


def get_prediction_history(code: str) -> list[dict]:
    """Predicted-vs-actual matrix for one code, newest first. `actual_*` fields are
    null until that date's close is available (i.e. the prediction hasn't graded yet).
    """
    history = prediction_store.get_history_for_code(code)
    if not history:
        return []

    df = price_fetcher.get_history(code, years=1).sort_values("date").reset_index(drop=True)
    dates = df["date"].tolist()
    closes = df["close"].tolist()
    date_index = {date: idx for idx, date in enumerate(dates)}

    records = []
    for date, pred in sorted(history.items(), reverse=True):
        actual_direction = None
        actual_change_pct = None
        correct = None
        idx = date_index.get(date)
        if idx is not None and idx > 0:
            prev_close = closes[idx - 1]
            curr_close = closes[idx]
            if prev_close:
                actual_change_pct = round((curr_close - prev_close) / prev_close * 100, 2)
                actual_direction = _actual_direction(actual_change_pct)
                correct = actual_direction == pred["direction"]

        records.append(
            {
                "date": date,
                "predicted_direction": pred["direction"],
                "confidence": pred.get("confidence"),
                "actual_direction": actual_direction,
                "actual_change_pct": actual_change_pct,
                "correct": correct,
            }
        )
    return records
