import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache

TTL_UNIVERSE_SECONDS = 24 * 3600


def _load_market(market: str) -> pd.DataFrame:
    df = fdr.StockListing(market)
    code_col = "Code" if "Code" in df.columns else "Symbol"
    df = df.rename(columns={code_col: "Code"})
    df = df[["Code", "Name", "Marcap"]].dropna()
    df["Market"] = market
    return df


def _get_kospi_universe() -> pd.DataFrame:
    return cache.get_or_set("kospi_universe", TTL_UNIVERSE_SECONDS, lambda: _load_market("KOSPI"))


def _load_full_universe() -> pd.DataFrame:
    # Search and name-resolution (KOSDAQ MAP tile clicks, the main page's search box)
    # need both markets; get_top_market_cap below intentionally stays KOSPI-only since
    # it feeds the investor-summary table, which has never covered KOSDAQ.
    return pd.concat([_get_kospi_universe(), _load_market("KOSDAQ")], ignore_index=True)


def _get_full_universe() -> pd.DataFrame:
    return cache.get_or_set("full_universe", TTL_UNIVERSE_SECONDS, _load_full_universe)


def get_universe() -> pd.DataFrame:
    return _get_full_universe()[["Code", "Name", "Market"]]


def get_top_market_cap(limit: int = 100) -> list[dict]:
    df = _get_kospi_universe().sort_values("Marcap", ascending=False).head(limit)
    return [{"code": str(row["Code"]), "name": str(row["Name"])} for _, row in df.iterrows()]


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
        {"code": str(row["Code"]), "name": str(row["Name"]), "market": str(row["Market"])}
        for _, row in matched.iterrows()
    ]


def get_stock_name(code: str) -> str | None:
    df = get_universe()
    row = df[df["Code"].astype(str) == code]
    if row.empty:
        return None
    return str(row.iloc[0]["Name"])
