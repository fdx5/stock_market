import pandas as pd

# crypto.randomUUID() is exactly what the frontend generates for its session id
# (see frontend/src/session.ts) — anything else is either a bug on the caller's
# end or a forged value. Shared by every endpoint that accepts a client-supplied
# session_id (visitor heartbeat, activity events) so they all reject the same way.
SESSION_ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


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
