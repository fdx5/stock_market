import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

TTL_NEWS_SECONDS = 15 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def _fetch_news(code: str, limit: int) -> list[dict]:
    url = f"https://finance.naver.com/item/news_news.naver?code={code}&page=1"
    resp = requests.get(url, headers=HEADERS, timeout=5)
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    items: list[dict] = []
    seen_links: set[str] = set()
    for row in soup.select("table.type5 tr"):
        title_tag = row.select_one("td.title a")
        if not title_tag:
            continue

        href = title_tag.get("href", "")
        link = f"https://finance.naver.com{href}" if href.startswith("/") else href
        if link in seen_links:
            continue
        seen_links.add(link)

        press_tag = row.select_one("td.info")
        date_tag = row.select_one("td.date")

        items.append(
            {
                "title": title_tag.get_text(strip=True),
                "link": link,
                "press": press_tag.get_text(strip=True) if press_tag else "",
                "date": date_tag.get_text(strip=True) if date_tag else "",
            }
        )
        if len(items) >= limit:
            break

    return items


def get_news(code: str, limit: int = 15) -> list[dict]:
    key = f"news:{code}"
    try:
        return cache.get_or_set(key, TTL_NEWS_SECONDS, lambda: _fetch_news(code, limit))
    except Exception:
        return []
