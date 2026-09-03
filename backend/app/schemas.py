from pydantic import BaseModel


class StockSearchResult(BaseModel):
    code: str
    name: str
    market: str
    asset_type: str = "STOCK"


class NewsItem(BaseModel):
    title: str
    link: str
    press: str
    date: str
