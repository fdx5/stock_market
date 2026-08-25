"""The 종목정보 page's backend: one row shape across three unlike markets, and the
Naver news search that stands in where finance.naver has no per-code tab.

These cover the two places the feature can be quietly wrong rather than broken: a US
row whose `marcap` is really an index weight (the number would look plausible and rank
the whole list incorrectly), and a news query sent in English (the panel fills with
articles, just not the right ones).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import io  # noqa: E402

from app.data import naver_news_search_fetcher as news_search  # noqa: E402
from app.data import us_company_korean_names as korean  # noqa: E402
from app.services import logo_tone  # noqa: E402
from app.services import stock_universe_page as universe  # noqa: E402


def _kr(code: str, name: str, cap: float, close: float) -> dict:
    return {"code": code, "name": name, "marcap": cap, "close": close, "change": 100.0,
            "change_pct": 1.5, "sector": "반도체", "volume": 1000, "per": 11.3, "roe": 9.0}


def _us(code: str, name: str, weight: float, cap: float) -> dict:
    # Note `marcap` is the index weight here, exactly as the US snapshot supplies it.
    return {"code": code, "name": name, "marcap": weight, "market_cap": cap, "close": 208.8,
            "change": -5.9, "change_pct": -2.76, "sector": "Information Technology", "volume": 1}


@pytest.fixture()
def fake_markets(monkeypatch):
    kospi = [_kr("005930", "삼성전자", 1.4e15, 251750), _kr("000660", "SK하이닉스", 1.1e15, 1621000)]
    # Ordered by weight but NOT by capitalisation, which is the case that catches a
    # roster ranking on the wrong field.
    sp500 = [_us("AVGO", "Broadcom Inc", 9.9, 1.0e12), _us("NVDA", "NVIDIA Corp", 7.2, 5.0e12)]
    monkeypatch.setitem(
        universe.MARKETS, "kospi",
        universe.MarketSpec("kospi", "KOSPI", "KRW", 500, lambda n, fresh: kospi),
    )
    monkeypatch.setitem(
        universe.MARKETS, "sp500",
        universe.MarketSpec("sp500", "S&P 500", "USD", 500, lambda n, fresh: sp500, cap_field="market_cap"),
    )
    monkeypatch.setattr(universe, "get_korean_names_ready", lambda: {})
    return kospi, sp500


class TestRosterShape:
    def test_us_rows_rank_and_report_capitalisation_not_index_weight(self, fake_markets):
        page = universe.get_page("sp500", 1)
        assert [row["code"] for row in page["items"]] == ["NVDA", "AVGO"]
        assert page["items"][0]["marcap"] == 5.0e12
        assert page["currency"] == "USD"

    def test_kr_rows_carry_the_same_fields(self, fake_markets):
        page = universe.get_page("kospi", 1)
        assert page["currency"] == "KRW"
        assert page["items"][0]["marcap"] == 1.4e15
        # One shape across markets: the client's list must not have to ask which
        # market a row came from to know what a field means.
        assert set(page["items"][0]) == set(universe.get_page("sp500", 1)["items"][0])

    def test_korean_name_is_only_ever_korean(self, fake_markets, monkeypatch):
        """The translate upstream returns its input unchanged when it is unavailable.
        An English string arriving that way must not be published as a Korean name."""
        monkeypatch.setattr(universe, "get_korean_names_ready", lambda: {"Broadcom Inc": "Broadcom Inc"})
        rows = {row["code"]: row for row in universe.get_page("sp500", 1)["items"]}
        assert rows["NVDA"]["name_ko"] == "엔비디아"      # curated
        assert rows["AVGO"]["name_ko"] == "브로드컴"      # curated, not the passthrough
        monkeypatch.setitem(korean.KOREAN_NAMES, "AVGO", "")
        assert universe.get_page("sp500", 1)["items"][1]["name_ko"] is None

    def test_kr_rows_never_carry_a_korean_name_field_value(self, fake_markets):
        assert universe.get_page("kospi", 1)["items"][0]["name_ko"] is None


class TestSectorFilter:
    def test_filtering_narrows_rows_and_page_count(self, fake_markets):
        page = universe.get_page("kospi", 1, size=10, sector="반도체")
        assert [row["code"] for row in page["items"]] == ["005930", "000660"]
        assert page["total"] == 2
        assert page["sector"] == "반도체"

    def test_rank_stays_the_rank_in_the_whole_market(self, monkeypatch):
        """A 반도체 view that renumbered its first row to 1 would be asserting something
        false — the detail panel prints the same number as 시총 N위."""
        rows = [_kr("000001", "큰회사", 9e14, 100), _kr("000002", "작은반도체", 1e14, 100)]
        rows[0]["sector"] = "금융"
        monkeypatch.setitem(
            universe.MARKETS, "kospi",
            universe.MarketSpec("kospi", "KOSPI", "KRW", 500, lambda n, fresh: rows),
        )
        monkeypatch.setattr(universe, "get_korean_names_ready", lambda: {})
        filtered = universe.get_page("kospi", 1, sector="반도체")
        assert [(row["rank"], row["code"]) for row in filtered["items"]] == [(2, "000002")]

    def test_options_are_computed_before_filtering(self, fake_markets):
        """The dropdown must hold the same options whichever one is chosen, or it
        becomes a filter nobody can navigate back out of."""
        assert universe.get_page("kospi", 1, sector="반도체")["sectors"] == universe.get_page("kospi", 1)["sectors"]

    def test_options_are_ordered_by_size_not_alphabetically(self, monkeypatch):
        rows = [_kr("000001", "A", 9e14, 1), _kr("000002", "B", 1e14, 1), _kr("000003", "C", 5e14, 1)]
        rows[0]["sector"], rows[1]["sector"], rows[2]["sector"] = "하", "가", "나"
        monkeypatch.setitem(
            universe.MARKETS, "kospi",
            universe.MarketSpec("kospi", "KOSPI", "KRW", 500, lambda n, fresh: rows),
        )
        monkeypatch.setattr(universe, "get_korean_names_ready", lambda: {})
        assert [o["sector"] for o in universe.get_page("kospi", 1)["sectors"]] == ["하", "나", "가"]

    def test_the_all_sentinel_and_none_both_mean_everything(self, fake_markets):
        assert universe.get_page("kospi", 1, sector=universe.ALL_SECTORS)["total"] == 2
        assert universe.get_page("kospi", 1, sector=None)["total"] == 2

    def test_an_unknown_sector_yields_an_empty_page_not_an_error(self, fake_markets):
        page = universe.get_page("kospi", 1, sector="존재하지않는업종")
        assert page["items"] == []
        assert page["total_pages"] == 1


class TestLogoTone:
    """The rule deciding which logos get a light plate on the dark theme.

    Both conditions have to be here, because each one alone gets a real logo wrong.
    """

    def _png(self, pixels, size=8):
        from PIL import Image

        image = Image.new("RGBA", (size, size))
        image.putdata(pixels)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def test_black_glyph_on_transparency_is_plated(self):
        """Apple: opaque black artwork over half the tile, transparent elsewhere."""
        assert logo_tone.needs_plate(self._png([(0, 0, 0, 255)] * 32 + [(0, 0, 0, 0)] * 32))

    def test_mostly_dark_lettering_with_a_bright_accent_is_plated(self):
        """Amazon's black wordmark with an orange smile, and Caterpillar's black CAT
        with a yellow triangle. Judging by the brightest pixel would pass both — the
        accent is bright and the name is not."""
        pixels = [(0, 0, 0, 255)] * 24 + [(255, 153, 0, 255)] * 6 + [(0, 0, 0, 0)] * 34
        assert logo_tone.needs_plate(self._png(pixels))

    def test_a_dark_badge_that_fills_its_tile_is_left_alone(self):
        """Every Naver logo: a dark disc with white lettering, covering the tile. It is
        its own background, so it reads at any tint — and it is darker on average than
        several marks that do need plating, which is why coverage has to be measured."""
        pixels = [(20, 40, 120, 255)] * 56 + [(255, 255, 255, 255)] * 8
        assert not logo_tone.needs_plate(self._png(pixels))

    def test_a_light_mark_is_left_alone(self):
        pixels = [(200, 210, 200, 255)] * 20 + [(0, 0, 0, 0)] * 44
        assert not logo_tone.needs_plate(self._png(pixels))

    def test_transparent_padding_is_not_counted_as_the_mark(self):
        dark_share, coverage = logo_tone.measure(
            self._png([(0, 0, 0, 255)] * 16 + [(255, 255, 255, 0)] * 48)
        )
        assert dark_share == 1.0
        assert coverage == 0.25

    def test_an_empty_image_is_unreadable_rather_than_dark(self):
        assert logo_tone.measure(self._png([(0, 0, 0, 0)] * 64)) is None
        assert logo_tone.needs_plate(self._png([(0, 0, 0, 0)] * 64)) is False

    def test_garbage_bytes_do_not_raise(self):
        assert logo_tone.measure(b"not an image") is None
        assert logo_tone.needs_plate(b"not an image") is False

    def test_us_tickers_resolve_to_the_hosts_own_spelling(self):
        """The alias and dot-to-hyphen rewrite lives in usLogo.ts, which builds the URL
        the browser loads. Without the same rewrite here the probe fetched nothing for
        these five, so they were silently never evaluated — and measuring a different
        image than the one on screen would be worse still."""
        assert logo_tone._logo_symbol("GOOGL") == "GOOG"
        assert logo_tone._logo_symbol("BRK.B") == "BRK-B"
        assert logo_tone._logo_symbol("BF.B") == "BF-A"
        assert logo_tone._logo_symbol("AAPL") == "AAPL"

    def test_a_self_hosted_logo_is_never_probed(self, monkeypatch):
        """SKHY's mark is served by this app and is a colour logo, so there is nothing
        to fetch and nothing to correct."""
        monkeypatch.setattr(logo_tone.cache, "peek", lambda key: None)
        fetched = []
        monkeypatch.setattr(logo_tone, "_fetch_kr", lambda code: fetched.append(code))
        assert logo_tone._probe("SKHY") is False
        assert fetched == []

    def test_an_unprobed_code_reads_as_not_dark(self, monkeypatch):
        """known_dark() is on the request path and must never fetch: a roster page may
        not wait on fifty logo downloads to pick a background colour."""
        monkeypatch.setattr(logo_tone.cache, "peek", lambda key: None)
        called = []
        monkeypatch.setattr(logo_tone, "_probe", lambda code: called.append(code) or True)
        assert logo_tone.known_dark("AAPL") is False
        assert called == []


class TestSiteGraph:
    def test_the_new_page_is_wired_into_the_monitor(self):
        """The monitor's diagram is curated by hand, so a page added without touching it
        is a page the diagram silently omits — the failure this test exists to catch."""
        import app.main
        from app.services.site_graph import build_graph

        graph = build_graph(app.main.app.routes)
        ids = {node["id"] for node in graph["nodes"]}
        assert "page:/stocks" in ids
        assert {e["target"] for e in graph["edges"] if e["source"] == "page:/stocks"} >= {
            "api:/api/market/stock-list",
            "api:/api/us-stock/{code}/news",
            "api:/api/stock/news-article",
        }
        # Every curated edge must still name a live route.
        assert not graph.get("warnings")


class TestPaging:
    @pytest.fixture()
    def hundred(self, monkeypatch):
        rows = [_kr(f"{i:06d}", f"종목{i}", 1e12 - i, 1000) for i in range(100)]
        monkeypatch.setitem(
            universe.MARKETS, "kospi",
            universe.MarketSpec("kospi", "KOSPI", "KRW", 500, lambda n, fresh: rows),
        )

    def test_ranks_continue_across_pages(self, hundred):
        assert universe.get_page("kospi", 1, 50)["items"][0]["rank"] == 1
        second = universe.get_page("kospi", 2, 50)
        assert second["items"][0]["rank"] == 51
        assert second["items"][-1]["rank"] == 100
        assert second["total_pages"] == 2

    def test_a_page_past_the_end_clamps_rather_than_erroring(self, hundred):
        """The roster's depth moves between requests; a viewer on the last page while
        it shrinks should land on the last page, not on an error."""
        page = universe.get_page("kospi", 99, 50)
        assert page["page"] == 2
        assert len(page["items"]) == 50


class TestKoreanNameQueries:
    def test_curated_name_wins_over_a_passthrough_translation(self):
        assert korean.news_query("NVDA", "NVIDIA Corp", "NVIDIA Corp") == "엔비디아"

    def test_a_real_translation_is_used_when_uncurated(self):
        assert korean.news_query("ZZZZ", "Zizzer Inc", "지저") == "지저"

    def test_english_fallback_drops_corporate_suffixes(self):
        assert korean.news_query("ZZZZ", "Coca-Cola Co/The", None) == "Coca-Cola"
        assert korean.news_query("ZZZZ", "Zizzer Technologies Inc", "Zizzer Technologies Inc") == "Zizzer Technologies"


class TestNewsSearchParsing:
    """Naver's search markup mixes stable design-system class names with rotating build
    hashes, so the parser keys off `data-heatmap-target` and document order. This is a
    captured shape of that markup, cluster included."""

    MARKUP = """
    <div class="list_news">
      <div class="sds-comps-vertical-layout aBcD1234">
        <a data-heatmap-target=".tit" href="https://news.example/lead">
          <span class="sds-comps-text-type-headline1"><mark>엔비디아</mark> 실적 발표</span>
          <span>새 창 열림</span>
        </a>
        <div class="xYz9876">
          <a data-heatmap-target=".tit" href="https://news.example/1">
            <span class="sds-comps-text-type-headline1">스페이스X AI, <mark>엔비디아</mark> 도입</span>
          </a>
          <a data-heatmap-target=".body" href="https://news.example/1">
            <span class="sds-comps-text-type-body1">본문 미리보기입니다.</span>
          </a>
          <span class="sds-comps-profile-info-title-text">지디넷코리아<span>새 창 열림</span></span>
          <span class="sds-comps-profile-info-subtext">3시간 전</span>
          <span class="sds-comps-profile-info-subtext">네이버뉴스</span>
          <a data-heatmap-target=".tit" href="https://news.example/2">
            <span class="sds-comps-text-type-headline1">엔비디아 7일 연속 하락</span>
          </a>
          <span class="sds-comps-profile-info-title-text">KBS</span>
          <span class="sds-comps-profile-info-subtext">2026.08.24.</span>
        </div>
      </div>
    </div>
    """

    def _parse(self, monkeypatch, limit=10):
        soup = BeautifulSoup(self.MARKUP, "html.parser")

        class Response:
            text = self.MARKUP

            def raise_for_status(self):
                return None

        monkeypatch.setattr(news_search.requests, "get", lambda *a, **k: Response())
        assert soup  # the markup is well-formed enough to parse
        return news_search._fetch("엔비디아", limit)

    def test_every_row_carries_its_own_byline(self, monkeypatch):
        items = self._parse(monkeypatch)
        assert [it["press"] for it in items] == ["지디넷코리아", "KBS"]
        assert [it["date"] for it in items] == ["3시간 전", "2026.08.24."]

    def test_the_cluster_headline_is_dropped(self, monkeypatch):
        """It has no byline of its own and duplicates a row beneath it."""
        items = self._parse(monkeypatch)
        assert all(it["link"] != "https://news.example/lead" for it in items)

    def test_mark_tags_do_not_eat_the_spaces_around_them(self, monkeypatch):
        items = self._parse(monkeypatch)
        assert items[0]["title"] == "스페이스X AI, 엔비디아 도입"

    def test_the_new_window_suffix_is_not_part_of_the_press_name(self, monkeypatch):
        assert self._parse(monkeypatch)[0]["press"] == "지디넷코리아"

    def test_naver_link_marker_is_not_read_as_a_timestamp(self, monkeypatch):
        assert "네이버뉴스" not in {it["date"] for it in self._parse(monkeypatch)}

    def test_summary_comes_from_the_row_it_belongs_to(self, monkeypatch):
        items = self._parse(monkeypatch)
        assert items[0]["summary"] == "본문 미리보기입니다."
        # The second row has no `.body` anchor before the list ends.
        assert items[1]["summary"] == ""

    def test_limit_is_respected(self, monkeypatch):
        assert len(self._parse(monkeypatch, limit=1)) == 1

    def test_a_failed_scrape_yields_an_empty_list_not_an_exception(self, monkeypatch):
        def explode(*args, **kwargs):
            raise RuntimeError("naver is down")

        monkeypatch.setattr(news_search.requests, "get", explode)
        news_search.cache.clear() if hasattr(news_search.cache, "clear") else None
        assert news_search.get_news("없는회사이름12345", 5) == []


class TestRelativeDates:
    def test_relative_ages_resolve_to_a_date(self):
        import datetime as dt

        now = dt.datetime(2026, 8, 25)
        assert news_search.to_absolute_date("3일 전", now) == "2026.08.22"
        assert news_search.to_absolute_date("2시간 전", now) == "2026.08.25"
        assert news_search.to_absolute_date("2026.08.20.", now) == "2026.08.20"
        assert news_search.to_absolute_date("네이버뉴스", now) == ""
