import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache

TTL_UNIVERSE_SECONDS = 24 * 3600


def _load_universe() -> pd.DataFrame:
    df = fdr.StockListing("KOSPI")
    code_col = "Code" if "Code" in df.columns else "Symbol"
    df = df.rename(columns={code_col: "Code"})
    return df[["Code", "Name"]].dropna()


def get_universe() -> pd.DataFrame:
    return cache.get_or_set("kospi_universe", TTL_UNIVERSE_SECONDS, _load_universe)


def search_stocks(query: str, limit: int = 10) -> list[dict]:
    query = query.strip()
    if not query:
        return []

    df = get_universe()
    mask = df["Code"].astype(str).str.contains(query, case=False, na=False) | df[
        "Name"
    ].astype(str).str.contains(query, case=False, na=False)
    matched = df[mask].head(limit)

    return [
        {"code": str(row["Code"]), "name": str(row["Name"]), "market": "KOSPI"}
        for _, row in matched.iterrows()
    ]


def get_stock_name(code: str) -> str | None:
    df = get_universe()
    row = df[df["Code"].astype(str) == code]
    if row.empty:
        return None
    return str(row.iloc[0]["Name"])
