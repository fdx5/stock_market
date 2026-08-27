"""Builds a SmartEditor ONE `documentModel` from a market brief payload.

This module is the answer to why the earlier automation attempt never actually posted a
report. Those scripts drove the editor with `page.keyboard.type(...)`, which meant the
rich HTML that naver_blog_exporter.py produces could not be used at all — SmartEditor
does not accept pasted HTML — so every one of them fell back to typing a handful of
emoji lines and dropped the analysis, the flows, the issues and the news entirely.

SmartEditor's real state is not the DOM. It is a JSON document model, and the editor
exposes it: setDocumentData() writes it, getDocumentData() reads it back normalized.
Generating that JSON directly means the full brief goes in, deterministically, with no
selector guessing and nothing to break the next time Naver reskins the write page.

Schema notes
    Every node carries an `@ctype` discriminator and a document-unique `id`. The shapes
    used here (documentTitle / text -> paragraph -> textNode, horizontalLine, quotation)
    are the common SmartEditor ONE components.

    The model is deliberately kept minimal — no styling beyond font size and bold. The
    editor normalizes whatever it is handed on the setDocumentData/getDocumentData round
    trip and fills in its own defaults, so over-specifying style here would only create
    more surface to drift out of sync with Naver. The client reads the model back after
    injection and compares component counts, which is what actually proves the content
    landed (see naver_blog_client.publish).
"""

import re
import uuid

# SmartEditor's own ids are "SE-<uuid4>" (confirmed by probing getDocumentData on a live
# write page). Matching that format matters less than uniqueness, but there is no reason
# to look different from what the editor produces.
def _sid() -> str:
    return f"SE-{uuid.uuid4()}"


def _text_node(value: str, *, bold: bool = False, size: str = "fs16", url: str | None = None) -> dict:
    """One run of text. `url` makes it a clickable link.

    The link shape was read off a live editor (type text, select it, apply the 링크
    toolbar, then getDocumentData) rather than guessed. It matters that it was checked:
    SmartEditor does **not** autolink a URL that merely appears in the text — a probe
    typing a bare URL produced a single plain textNode with no link at all, which is why
    the first published post's links were dead text.
    """
    node = {
        "id": _sid(),
        "value": value,
        "@ctype": "textNode",
        "style": {
            "@ctype": "nodeStyle",
            "fontSizeCode": size,
            "bold": bold,
        },
    }
    if url:
        node["link"] = {"url": url, "@ctype": "urlLink"}
    return node


def _paragraph_nodes(nodes: list[dict]) -> dict:
    """A paragraph built from pre-made nodes, for mixing plain and linked runs."""
    return {"id": _sid(), "nodes": nodes, "@ctype": "paragraph"}


def _paragraph(value: str, *, bold: bool = False, size: str = "fs16") -> dict:
    """One visual line. An empty string yields an empty paragraph, i.e. a blank line —
    SmartEditor represents those as a paragraph with no nodes, not as a node holding
    an empty string, and an empty-string node is one of the things it silently drops."""
    return {
        "id": _sid(),
        "nodes": [] if value == "" else [_text_node(value, bold=bold, size=size)],
        "@ctype": "paragraph",
    }


def _text_component(lines: list[dict]) -> dict:
    return {"id": _sid(), "layout": "default", "value": lines, "@ctype": "text"}


# Only `documentTitle` and `text` are emitted, and that is a deliberate restriction.
#
# The first version of this module also built `quotation` and `horizontalLine`
# components from guessed schemas, and the guess was wrong in a way that took the whole
# post down: SmartEditor stores a documentTitle's paragraphs under `title`, not `value`,
# so setDocumentData walked an undefined array and threw
# "Cannot read properties of undefined (reading 'forEach')" — killing every one of the
# seven posts, not just the styling.
#
# `text` and `documentTitle` are the two shapes confirmed against a live editor (see
# scripts/naver_probe_editor.py). Everything visual is expressed with those: a rule is a
# line of box-drawing characters, a pull quote is a bold paragraph. Losing a styled
# divider is worth far more than risking the entire body on an unverified schema.
_RULE = "─" * 24


def _section(heading: str, body_lines: list[str]) -> list[dict]:
    """A bold heading followed by its body, as two components.

    Kept as separate components rather than one so the heading survives independently:
    SmartEditor merges adjacent paragraphs inside a single text component in some
    reflows, which would otherwise pull the heading's styling down into the body.
    """
    out = [_text_component([_paragraph(""), _paragraph(heading, bold=True, size="fs19")])]
    if body_lines:
        out.append(_text_component([_paragraph(line) for line in body_lines]))
    return out


def build_title_paragraphs(title: str) -> list[dict]:
    """Paragraph list for a documentTitle component's `title` field."""
    return [_paragraph(title, bold=True, size="fs32")]


# Chart placeholders. The body is built here, in Python, where it can be unit-tested,
# but an `image` component can only be created by actually uploading a file through the
# editor — the component carries Naver-side resource fields (domain, path, dimensions)
# that cannot be fabricated. So the builder emits markers and the client swaps in the
# real components after upload, dropping any marker whose upload did not happen.
IMAGE_MARKER = "__naver_chart__"


def _image_slot(slug: str) -> dict:
    return {IMAGE_MARKER: slug}


def resolve_image_slots(components: list[dict], uploaded: dict[str, dict]) -> list[dict]:
    """Replaces markers with real image components; drops markers with no upload.

    Dropping rather than failing is deliberate: a chart that did not upload should cost
    the post its picture, not its publication.
    """
    out = []
    for comp in components:
        slug = comp.get(IMAGE_MARKER)
        if slug is None:
            out.append(comp)
            continue
        real = uploaded.get(slug)
        if real:
            out.append(real)
    return out


def image_slots(components: list[dict]) -> list[str]:
    return [c[IMAGE_MARKER] for c in components if IMAGE_MARKER in c]


def _fmt_money(value) -> str:
    """Investor flows arrive in 억원; promote to 조원 past 10,000. Mirrors
    market_brief._flow_money so the blog post and the site agree on the same numbers."""
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return "0원"
    sign = "+" if amount > 0 else "-" if amount < 0 else ""
    magnitude = abs(amount)
    if magnitude >= 10_000:
        return f"{sign}{magnitude / 10_000:,.2f}조원"
    return f"{sign}{magnitude:,.0f}억원"


def _fmt_close(index: dict, is_stock: bool) -> str:
    close = float(index.get("close") or 0)
    return f"{close:,.0f}원" if is_stock else f"{close:,.2f}pt"


def build_title(brief: dict, meta: dict) -> str:
    """Post title. Contains 종목명 and 날짜 as required.

    Reuses the SEO-oriented shape naver_blog_exporter.generate_seo_blog_post already
    settled on rather than the plainer "[날짜 장마감] 종목 리포트" example — both satisfy
    the requirement, and this one carries the close and the change into the title, which
    is what makes it useful in a Naver search result.
    """
    date = brief.get("date", "")
    index = brief.get("index", {})
    close = float(index.get("close") or 0)
    pct = float(index.get("change_pct") or 0)
    sign = "+" if pct > 0 else ""
    if meta.get("type") == "stock":
        return (
            f"[{date}] {meta['name']} 주가 전망 및 장마감 브리핑 | "
            f"종가 {close:,.0f}원 ({sign}{pct:.2f}%) 외인·기관 수급 분석"
        )
    return (
        f"[{date}] {meta['name']} 마감 시황 분석 | "
        f"{close:,.2f}pt ({sign}{pct:.2f}%) 거래대금·외국인 수급 총정리"
    )


def build_tags(brief: dict, meta: dict) -> list[str]:
    """Tag list for populationParams. Naver caps tags at 30 per post; the configured
    keywords plus the four generic ones stay well inside that."""
    date = str(brief.get("date", "")).replace("-", "")
    tags = list(meta.get("keywords", []))
    tags += [f"{date}증시", "주식시장전망", "오늘의브리핑", "주식투자전략"]
    # Naver rejects tags containing whitespace or '#'.
    cleaned = []
    for tag in tags:
        slug = re.sub(r"[#\s]", "", str(tag))
        if slug and slug not in cleaned:
            cleaned.append(slug)
    return cleaned[:30]


def build_body_components(brief: dict, meta: dict, *, site_url: str) -> list[dict]:
    """The post body as `text` components, excluding the title.

    The client merges these into the skeleton the live editor hands back, rather than
    shipping a whole document built here — see naver_blog_client.publish. That keeps
    document-level fields (version, id, di) owned by the editor, so a Naver schema bump
    stops being our problem.
    """
    date = brief.get("date", "")
    index = brief.get("index", {})
    investor = brief.get("investor", {})
    is_stock = meta.get("type") == "stock"

    change = float(index.get("change") or 0)
    pct = float(index.get("change_pct") or 0)
    sign = "+" if pct > 0 else ""
    change_str = f"{change:+,.0f}" if is_stock else f"{change:+,.2f}"

    components: list[dict] = []

    summary = brief.get("summary")
    if summary:
        components.append(_text_component([_paragraph(f"『 {summary} 』", bold=True)]))

    # Headline numbers + flows (+ breadth on index reports) as a chart, directly under
    # the summary. The same figures still follow in text below: the picture is for the
    # reader, the text is what Naver search indexes.
    components.append(_image_slot("summary"))

    components += _section(
        "📊 마감 지표",
        [
            f"· 종가: {_fmt_close(index, is_stock)}",
            f"· 전일 대비: {change_str} ({sign}{pct:.2f}%)",
            f"· 추정 거래대금: {float(brief.get('turnover_estimate') or 0) / 1e12:,.2f}조원",
        ],
    )

    breadth = brief.get("breadth") or {}
    if not is_stock and breadth:
        components += _section(
            "📈 시장 내부 지표",
            [
                f"· 상승 {breadth.get('advance', 0)}종목 / 하락 {breadth.get('decline', 0)}종목 / 보합 {breadth.get('flat', 0)}종목",
                f"· 상승 종목 비중: {breadth.get('advance_ratio', 0)}%",
            ],
        )

    components += _section(
        "💰 투자자별 수급",
        [
            f"· 외국인: {_fmt_money(investor.get('foreign_amount'))}",
            f"· 기관: {_fmt_money(investor.get('institution_amount'))}",
            f"· 개인: {_fmt_money(investor.get('individual_amount'))}",
        ],
    )

    components.append(_text_component([_paragraph(""), _paragraph(_RULE)]))

    analysis = [a for a in (brief.get("analysis") or []) if a]
    if analysis:
        # Blank line between paragraphs — seven dense paragraphs run together are
        # unreadable on mobile, which is where most Naver blog traffic lands.
        body: list[dict] = []
        for i, para in enumerate(analysis):
            if i:
                body.append(_paragraph(""))
            body.append(_paragraph(para))
        components.append(
            _text_component([_paragraph(""), _paragraph("📝 마감 심층 분석", bold=True, size="fs19")])
        )
        components.append(_text_component(body))

    key_issues = [k for k in (brief.get("key_issues") or []) if k]
    if key_issues:
        components += _section("💡 오늘 시장 핵심 이슈", [f"{i}. {v}" for i, v in enumerate(key_issues, 1)])

    checkpoints = [c for c in (brief.get("checkpoints") or []) if c]
    if checkpoints:
        components += _section("🔍 다음 거래일 체크포인트", [f"{i}. {v}" for i, v in enumerate(checkpoints, 1)])

    components.append(_image_slot("movers"))
    if not is_stock:
        components.append(_image_slot("sectors"))

    headlines = [h for h in (brief.get("headlines") or []) if h.get("title")]
    if headlines:
        # The headline itself is the link. Printing the raw URL on its own line was both
        # ugly and useless — SmartEditor does not autolink text, so those lines rendered
        # as dead strings the reader had to copy by hand.
        news_paras = [_paragraph(""), _paragraph("📰 마감 주요 뉴스", bold=True, size="fs19")]
        for h in headlines[:6]:
            # The two brief paths carry different keys: the stock path sets `press`,
            # the index path sets `stock` (the ticker the headline was collected for)
            # and no press at all. Falling back to a literal "언론사" made every index
            # post read "[언론사] ..." six times over, so prefer the ticker and drop
            # the bracket entirely when neither is present.
            label = h.get("press") or h.get("stock")
            prefix = f"· [{label}] " if label else "· "
            nodes = [_text_node(prefix)]
            nodes.append(_text_node(h["title"], url=h.get("url") or None))
            news_paras.append(_paragraph_nodes(nodes))
        components.append(_text_component(news_paras))

    components.append(_text_component([_paragraph(""), _paragraph(_RULE)]))

    report_url = f"{site_url}/market-brief/{date}/{str(brief.get('market', '')).lower()}"
    components.append(
        _text_component(
            [
                _paragraph(""),
                _paragraph("🌐 실시간 차트 및 인터랙티브 맵", bold=True, size="fs19"),
                _paragraph_nodes([_text_node("K-Stock Hub에서 이 리포트 보기", url=report_url)]),
            ]
        )
    )

    disclaimer = brief.get("disclaimer") or (
        "본 포스팅은 공개 시장 데이터를 자동 집계한 투자 참고 자료이며 투자 권유가 아닙니다."
    )
    components.append(_text_component([_paragraph(""), _paragraph(f"※ {disclaimer}", size="fs13")]))

    # Site-promo closing block. Unconditional — every post ends with this, stock and
    # index reports alike, regardless of what else landed above. The image is
    # best-effort like the other chart slots (naver_publisher supplies it, or doesn't,
    # and resolve_image_slots drops the marker either way); the link text is not, since
    # a dead marker should never be the only thing standing between a reader and the
    # promo link SmartEditor can't attach directly to an uploaded image component.
    components.append(_image_slot("kospimap"))
    components.append(
        _text_component(
            [
                _paragraph(""),
                _paragraph("🗺️ 코스피 전체 지도 한눈에 보기", bold=True, size="fs19"),
                _paragraph_nodes(
                    [_text_node("K-Stock Hub 코스피 시가총액 MAP 바로가기", url=f"{site_url}/map")]
                ),
            ]
        )
    )

    return components


def merge_into_skeleton(skeleton: dict, title_paragraphs: list[dict], body: list[dict]) -> dict:
    """Puts our content into the document the editor handed back.

    The skeleton supplies the documentTitle component (whose paragraphs live under
    `title`, not `value` — the difference that broke the first implementation) along with
    `version`, `id` and `di`. We only swap the title's paragraphs and replace the body
    components, so nothing schema-level is invented here.

    Kept in Python rather than in the injected JS so it is unit-testable.
    """
    document = (skeleton or {}).get("document") or {}
    components = list(document.get("components") or [])

    title_component = next((c for c in components if c.get("@ctype") == "documentTitle"), None)
    if title_component is None:
        raise ValueError("editor skeleton has no documentTitle component")

    title_component = dict(title_component)
    title_component["title"] = title_paragraphs

    merged = dict(skeleton)
    merged["document"] = dict(document)
    merged["document"]["components"] = [title_component] + list(body)
    return merged


def build_population_params(tags: list[str], *, category_id: int | None = None) -> dict:
    """Publishing metadata. `postWriteTimeType: "now"` is what makes this an immediate
    public publish rather than a scheduled ("pre") one — the requirement is a published
    post, not a draft or a reservation."""
    meta: dict = {
        "postWriteTimeType": "now",
        "tags": ",".join(tags),
    }
    if category_id is not None:
        meta["categoryId"] = category_id
    return {"populationMeta": meta}


def component_count(document_model: dict) -> int:
    return len(((document_model or {}).get("document") or {}).get("components") or [])
