import pandas as pd


def _clean_value(value):
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def dataframe_to_records(df: pd.DataFrame) -> list[dict]:
    records = df.to_dict(orient="records")
    return [{key: _clean_value(value) for key, value in record.items()} for record in records]
