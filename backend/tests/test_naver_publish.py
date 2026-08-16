"""Tests for the Naver blog auto-publish feature.

Two things are worth testing without a browser, and they are the two things that would
actually hurt in production:

1. Idempotency. "동일 (종목, 날짜) 조합이 중복 발행되지 않는다" is an acceptance criterion,
   and it is enforced by naver_publish_store.claim() rather than by any caller — so that
   is what gets tested, including the concurrent case.

2. The document model. The earlier automation shipped for weeks publishing nothing but
   a few emoji lines because nobody asserted that the report body was in the payload.
   These tests assert the analysis paragraphs, issues, checkpoints and flows all make it
   into the component tree.

The Playwright path is deliberately not mocked into a fake "publish" — a mock browser
would prove nothing about SmartEditor. That path is validated for real with
`python scripts/naver_publish_now.py --dry-run`, which drives everything up to the
publish click against the live account.

    cd backend && python -m pytest tests/ -v
"""

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def store(monkeypatch):
    """naver_publish_store bound to a throwaway SQLite file."""
    from app.services import naver_publish_store

    tmp = Path(tempfile.mkdtemp()) / "publish.db"
    monkeypatch.setattr(naver_publish_store, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(naver_publish_store, "LOCAL_DB_PATH", tmp)
    monkeypatch.setattr(naver_publish_store, "_conn", None)
    yield naver_publish_store
    monkeypatch.setattr(naver_publish_store, "_conn", None)


# --- idempotency --------------------------------------------------------------------


def test_enqueue_is_idempotent(store):
    assert store.enqueue("2026-08-17", "SAMSUNG") is True
    assert store.enqueue("2026-08-17", "SAMSUNG") is False
    assert len(store.pending("2026-08-17")) == 1


def test_enqueue_does_not_resurrect_a_published_row(store):
    """The brief batch re-runs on every restart after 16:10, so this is the realistic
    double-trigger: a second enqueue must not put an already-published post back in the
    queue."""
    store.enqueue("2026-08-17", "KOSPI")
    store.claim("2026-08-17", "KOSPI")
    store.mark_published("2026-08-17", "KOSPI", "223344", "https://blog.naver.com/x/223344")

    assert store.enqueue("2026-08-17", "KOSPI") is False
    assert store.pending("2026-08-17") == []
    assert store.get("2026-08-17", "KOSPI")["status"] == "published"


def test_claim_succeeds_once_then_refuses(store):
    store.enqueue("2026-08-17", "HYNIX")
    assert store.claim("2026-08-17", "HYNIX") is True
    assert store.claim("2026-08-17", "HYNIX") is False


def test_published_row_cannot_be_claimed(store):
    store.enqueue("2026-08-17", "HYUNDAI")
    store.claim("2026-08-17", "HYUNDAI")
    store.mark_published("2026-08-17", "HYUNDAI", "1", "u")
    assert store.claim("2026-08-17", "HYUNDAI") is False


def test_concurrent_claims_yield_exactly_one_winner(store):
    """Two threads racing the same row is what a chained batch plus a manual trigger
    actually looks like."""
    store.enqueue("2026-08-17", "SEMCO")
    results = []
    barrier = threading.Barrier(8)

    def attempt():
        barrier.wait()
        results.append(store.claim("2026-08-17", "SEMCO"))

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sum(1 for r in results if r) == 1


def test_failed_row_is_retryable_until_max_attempts(store):
    store.enqueue("2026-08-17", "SKSQUARE")
    for i in range(store.MAX_ATTEMPTS):
        assert store.claim("2026-08-17", "SKSQUARE") is True, f"attempt {i + 1} should be claimable"
        store.mark_failed("2026-08-17", "SKSQUARE", "boom")

    assert store.claim("2026-08-17", "SKSQUARE") is False
    assert store.pending("2026-08-17") == []


def test_different_dates_are_independent(store):
    store.enqueue("2026-08-17", "KOSPI")
    store.claim("2026-08-17", "KOSPI")
    store.mark_published("2026-08-17", "KOSPI", "1", "u")

    assert store.enqueue("2026-08-18", "KOSPI") is True
    assert store.claim("2026-08-18", "KOSPI") is True


def test_release_stale_returns_claims(store):
    store.enqueue("2026-08-17", "KOSDAQ")
    store.claim("2026-08-17", "KOSDAQ")
    assert store.claim("2026-08-17", "KOSDAQ") is False

    store.release_stale(older_than_minutes=-1)  # everything is "stale"
    assert store.claim("2026-08-17", "KOSDAQ") is True


# --- document model -----------------------------------------------------------------

BRIEF = {
    "version": 3,
    "date": "2026-08-17",
    "market": "SAMSUNG",
    "target_type": "stock",
    "index": {"close": 274500, "change": 6500, "change_pct": 2.43},
    "investor": {"foreign_amount": 13487.4, "institution_amount": -5025.9, "individual_amount": -8370.1},
    "breadth": {"advance": 60, "decline": 40, "flat": 0, "advance_ratio": 60.0},
    "turnover_estimate": 5.874118e12,
    "summary": "삼성전자는 외국인 순매수에 힘입어 상승 마감했습니다.",
    "analysis": [f"분석 문단 {i}" for i in range(1, 8)],
    "key_issues": [f"이슈 {i}" for i in range(1, 5)],
    "checkpoints": [f"체크 {i}" for i in range(1, 5)],
    "headlines": [{"title": "삼성전자 외국인 순매수", "url": "https://n.news/1", "press": "한국경제"}],
    "disclaimer": "투자 참고 자료입니다.",
}

META = {
    "market": "SAMSUNG",
    "name": "삼성전자 (005930)",
    "type": "stock",
    "keywords": ["삼성전자", "005930", "HBM3E"],
}


def _all_text(components) -> str:
    return json.dumps(components, ensure_ascii=False)


def _body(brief=None, meta=None, with_charts=False):
    """Body components with image markers already resolved.

    Charts are uploaded through the editor at publish time, so the builder emits markers
    and the client swaps in real components. Tests that care about text call this, which
    resolves markers to nothing (the no-charts case); the marker mechanism itself is
    tested separately below.
    """
    from app.services import naver_document_model

    raw = naver_document_model.build_body_components(
        brief or BRIEF, meta or META, site_url="https://example.com"
    )
    if with_charts:
        return raw
    return naver_document_model.resolve_image_slots(raw, {})


# The empty document SmartEditor actually hands back, trimmed. Captured from a live
# write page with scripts/naver_probe_editor.py — the documentTitle's paragraphs live
# under `title`, which is the detail that broke the first implementation.
SKELETON = {
    "documentId": "",
    "document": {
        "version": "2.10.2",
        "theme": "default",
        "language": "ko-KR",
        "id": "01M06AYGBV9MPZ2X7Z12BHNV9P",
        "components": [
            {
                "id": "SE-title",
                "layout": "default",
                "title": [{"id": "SE-p", "nodes": [{"id": "SE-n", "value": "", "@ctype": "textNode"}], "@ctype": "paragraph"}],
                "subTitle": None,
                "align": "left",
                "@ctype": "documentTitle",
            },
            {
                "id": "SE-body",
                "layout": "default",
                "value": [{"id": "SE-p2", "nodes": [{"id": "SE-n2", "value": "", "@ctype": "textNode"}], "@ctype": "paragraph"}],
                "@ctype": "text",
            },
        ],
        "di": {"dif": False, "dio": [{"dis": "N", "dia": {"t": 0, "p": 0, "st": 3, "sk": 0}}]},
    },
}


def test_title_contains_name_and_date():
    from app.services import naver_document_model

    title = naver_document_model.build_title(BRIEF, META)
    assert "삼성전자" in title
    assert "2026-08-17" in title


def test_document_model_carries_the_whole_report():
    """The failure this guards against is the one that already happened: a post that
    publishes successfully but contains none of the report."""
    from app.services import naver_document_model

    blob = _all_text(_body())

    for paragraph in BRIEF["analysis"]:
        assert paragraph in blob, f"missing analysis paragraph: {paragraph}"
    for issue in BRIEF["key_issues"]:
        assert issue in blob
    for checkpoint in BRIEF["checkpoints"]:
        assert checkpoint in blob
    assert BRIEF["summary"] in blob
    assert BRIEF["headlines"][0]["title"] in blob
    assert BRIEF["disclaimer"] in blob


def test_body_components_are_all_text():
    """Only `documentTitle` and `text` have schemas verified against a live editor.
    Emitting anything else is what produced the setDocumentData forEach crash."""
    assert {c["@ctype"] for c in _body()} == {"text"}


# --- chart image slots ----------------------------------------------------------------


def test_body_declares_chart_slots():
    from app.services import naver_document_model

    slots = naver_document_model.image_slots(_body(with_charts=True))
    assert "summary" in slots
    assert "movers" in slots
    # Sector breakdown is an index-level view; a single stock has no sectors block worth
    # charting, and render_sectors returns None for it.
    index_slots = naver_document_model.image_slots(
        _body(dict(BRIEF, market="KOSPI"), dict(META, type="index"), with_charts=True)
    )
    assert "sectors" in index_slots
    assert "sectors" not in slots


def test_unresolved_slots_are_dropped_not_published_as_junk():
    """An upload that failed must cost the post its picture, never its publication."""
    from app.services import naver_document_model

    raw = _body(with_charts=True)
    resolved = naver_document_model.resolve_image_slots(raw, {})
    assert len(resolved) == len(raw) - len(naver_document_model.image_slots(raw))
    assert all("@ctype" in c for c in resolved)


def test_resolved_slots_become_the_uploaded_components_in_place():
    from app.services import naver_document_model

    raw = _body(with_charts=True)
    fake = {"id": "SE-img", "@ctype": "image", "src": "https://blogfiles/x.png"}
    resolved = naver_document_model.resolve_image_slots(raw, {"summary": fake})

    images = [c for c in resolved if c.get("@ctype") == "image"]
    assert images == [fake]
    # It lands where the marker was: right after the summary pull quote.
    assert resolved.index(fake) == raw.index(next(c for c in raw if c.get(naver_document_model.IMAGE_MARKER) == "summary"))


def test_merge_puts_title_under_title_not_value():
    from app.services import naver_document_model

    title_paras = naver_document_model.build_title_paragraphs("제목입니다")
    merged = naver_document_model.merge_into_skeleton(SKELETON, title_paras, _body())

    components = merged["document"]["components"]
    assert components[0]["@ctype"] == "documentTitle"
    # The crash was setDocumentData walking components[0].title when it was absent.
    assert "title" in components[0]
    assert components[0]["title"] == title_paras
    assert "제목입니다" in _all_text(components[0]["title"])
    assert sum(1 for c in components if c["@ctype"] == "documentTitle") == 1


def test_merge_preserves_editor_owned_document_fields():
    from app.services import naver_document_model

    merged = naver_document_model.merge_into_skeleton(
        SKELETON, naver_document_model.build_title_paragraphs("t"), _body()
    )
    assert merged["document"]["version"] == "2.10.2"
    assert merged["document"]["id"] == "01M06AYGBV9MPZ2X7Z12BHNV9P"
    assert merged["document"]["di"] == SKELETON["document"]["di"]


def test_merge_does_not_mutate_the_skeleton():
    from app.services import naver_document_model
    import copy

    original = copy.deepcopy(SKELETON)
    naver_document_model.merge_into_skeleton(
        SKELETON, naver_document_model.build_title_paragraphs("t"), _body()
    )
    assert SKELETON == original


def test_merge_rejects_a_skeleton_without_a_title_component():
    from app.services import naver_document_model

    broken = {"document": {"components": [{"@ctype": "text", "value": []}]}}
    with pytest.raises(ValueError):
        naver_document_model.merge_into_skeleton(broken, [], [])


def test_every_component_has_a_unique_id():
    """SmartEditor drops components that collide on id, which would silently truncate
    the post."""
    from app.services import naver_document_model

    model = naver_document_model.merge_into_skeleton(
        SKELETON, naver_document_model.build_title_paragraphs("t"), _body()
    )
    ids = []

    def walk(node):
        if isinstance(node, dict):
            if "id" in node and isinstance(node["id"], str):
                ids.append(node["id"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(model)
    assert len(ids) == len(set(ids))


def test_flows_are_formatted_not_raw():
    from app.services import naver_document_model

    blob = _all_text(_body())
    assert "+1.35조원" in blob   # 13487.4억 -> 조원
    assert "-5,026억원" in blob  # institution stays in 억원


def test_index_brief_includes_breadth_but_stock_brief_does_not():
    from app.services import naver_document_model

    index_brief = dict(BRIEF, market="KOSPI", target_type="market")
    index_meta = dict(META, type="index", name="코스피 (KOSPI)")

    stock_blob = _all_text(_body())
    index_blob = _all_text(_body(index_brief, index_meta))

    assert "시장 내부 지표" in index_blob
    assert "시장 내부 지표" not in stock_blob


def test_tags_are_cleaned_and_capped():
    from app.services import naver_document_model

    meta = dict(META, keywords=["삼성 전자", "#HBM", "삼성전자", "삼성전자"])
    tags = naver_document_model.build_tags(BRIEF, meta)

    assert "삼성전자" in tags
    assert "HBM" in tags
    assert all(" " not in t and "#" not in t for t in tags)
    assert len(tags) == len(set(tags))
    assert len(tags) <= 30


def test_population_params_publish_immediately():
    from app.services import naver_document_model

    params = naver_document_model.build_population_params(["a", "b"])
    assert params["populationMeta"]["postWriteTimeType"] == "now"
    assert params["populationMeta"]["tags"] == "a,b"


def test_empty_optional_sections_do_not_break_the_model():
    from app.services import naver_document_model

    sparse = dict(BRIEF, analysis=[], key_issues=[], checkpoints=[], headlines=[])
    body = naver_document_model.build_body_components(sparse, META, site_url="https://e.com")
    assert len(body) > 0
    merged = naver_document_model.merge_into_skeleton(
        SKELETON, naver_document_model.build_title_paragraphs("t"), body
    )
    assert merged["document"]["components"][0]["@ctype"] == "documentTitle"


# --- clickable links ------------------------------------------------------------------
#
# SmartEditor does NOT autolink a URL that merely appears in the text — verified against
# a live editor, which returned one plain textNode for a typed URL. Links therefore have
# to be explicit link nodes, and these tests exist because the first published post
# shipped with every link dead.


def _nodes(components):
    out = []
    for comp in components:
        for para in comp.get("value", []):
            out.extend(para.get("nodes", []))
    return out


def test_news_headlines_are_clickable_links():
    linked = [n for n in _nodes(_body()) if n.get("link")]
    titles = {n["value"] for n in linked}
    assert BRIEF["headlines"][0]["title"] in titles
    for node in linked:
        assert node["link"]["@ctype"] == "urlLink"
        assert node["link"]["url"].startswith("http")


def test_report_link_is_clickable_and_points_at_this_report():
    urls = [n["link"]["url"] for n in _nodes(_body()) if n.get("link")]
    assert any(u.endswith("/market-brief/2026-08-17/samsung") for u in urls), urls


def test_no_bare_url_is_left_as_dead_text():
    """A raw URL sitting in a plain node is exactly the dead-link bug."""
    for node in _nodes(_body()):
        if node.get("link"):
            continue
        assert "http" not in node.get("value", ""), f"bare URL in plain text: {node['value']!r}"


def test_headline_without_a_url_stays_plain_rather_than_breaking():
    brief = dict(BRIEF, headlines=[{"title": "URL 없는 기사", "press": "한국경제"}])
    nodes = _nodes(_body(brief))
    match = [n for n in nodes if n["value"] == "URL 없는 기사"]
    assert match and not match[0].get("link")


# --- holiday guard --------------------------------------------------------------------
#
# `weekday() < 5` does not know about public holidays. On 2026-08-17 (광복절 대체공휴일,
# a Monday) the brief loop fires, generate() returns the previous session's report dated
# 2026-08-14, and chaining the publisher on that would ask it to republish a day whose
# posts already went out.


def test_publisher_refuses_a_date_whose_posts_are_already_out(store):
    """The ledger is the backstop behind the loop's date check."""
    for market in ("KOSPI", "KOSDAQ", "SAMSUNG"):
        store.enqueue("2026-08-14", market)
        store.claim("2026-08-14", market)
        store.mark_published("2026-08-14", market, "1", "u")

    # A holiday run re-enqueues the same trading date...
    for market in ("KOSPI", "KOSDAQ", "SAMSUNG"):
        assert store.enqueue("2026-08-14", market) is False
    # ...and finds nothing to do.
    assert store.pending("2026-08-14") == []


def test_reset_does_not_revive_published_rows():
    """`--reset` is the operator's escape hatch for a wedged retry count. It must not
    turn into a republish button — the holiday path would then post duplicates."""
    from app.services import naver_publish_store

    import tempfile as _t
    from pathlib import Path as _P

    tmp = _P(_t.mkdtemp()) / "p.db"
    old_url, old_path, old_conn = (
        naver_publish_store.TURSO_DATABASE_URL,
        naver_publish_store.LOCAL_DB_PATH,
        naver_publish_store._conn,
    )
    naver_publish_store.TURSO_DATABASE_URL = None
    naver_publish_store.LOCAL_DB_PATH = tmp
    naver_publish_store._conn = None
    try:
        naver_publish_store.enqueue("2026-08-14", "KOSPI")
        naver_publish_store.claim("2026-08-14", "KOSPI")
        naver_publish_store.mark_published("2026-08-14", "KOSPI", "9", "u")

        naver_publish_store.enqueue("2026-08-14", "KOSDAQ")
        naver_publish_store.claim("2026-08-14", "KOSDAQ")
        naver_publish_store.mark_failed("2026-08-14", "KOSDAQ", "boom")

        naver_publish_store.reset("2026-08-14")

        assert naver_publish_store.get("2026-08-14", "KOSPI")["status"] == "published"
        assert naver_publish_store.get("2026-08-14", "KOSDAQ")["status"] == "pending"
    finally:
        naver_publish_store.TURSO_DATABASE_URL = old_url
        naver_publish_store.LOCAL_DB_PATH = old_path
        naver_publish_store._conn = old_conn
