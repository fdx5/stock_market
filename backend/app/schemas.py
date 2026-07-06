from pydantic import BaseModel


class StockSearchResult(BaseModel):
    code: str
    name: str
    market: str


class NewsItem(BaseModel):
    title: str
    link: str
    press: str
    date: str
