"""The 60% of the prediction that isn't chart mechanics.

The remaining 40% (trend + order book) is arithmetic on numbers this app already
collects — see prediction_engine. This module covers what that arithmetic can't see:
what the press is saying, how the index and the sector are behaving, whether foreign
and institutional money is behind the move, and how a name's situation compares with
its peers on the same day.

Two implementations, one contract. When ANTHROPIC_API_KEY is set, Claude reads the
whole market's roster in a single call and returns a judgement per stock; when it
isn't, a deterministic lexicon-and-macro engine produces the same shape offline. The
batch runs either way — the key upgrades the quality of the 60%, it isn't a
prerequisite for the pipeline existing.

Claude sees the *whole market at once* rather than one stock per call, which is both
the cheaper shape and the better one: same-day peer comparison ("every memory name
here is bid, this one isn't") is only available to a reader who has the other rows in
front of them.
"""

import json
import logging
import os
import re

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
# Overridable so the operator can trade quality for cost without editing code — this
# runs ~34 stocks twice a day. Opus is the default because the judgement being asked
# for here (weighing conflicting headlines against a technical setup) is exactly the
# kind of call a weaker model gets confidently wrong.
AI_MODEL = os.environ.get("PREDICTION_AI_MODEL", "claude-opus-4-8")
AI_EFFORT = os.environ.get("PREDICTION_AI_EFFORT", "high")

DETAIL_MAX_CHARS = 500
CLOSE_SUMMARY_MAX_CHARS = 260

SOURCE_CLAUDE = "claude"
SOURCE_HEURISTIC = "heuristic"

_SYSTEM_PROMPT = """당신은 한국 증권사 리서치센터의 시니어 애널리스트입니다. 장 마감 직후 데이터를 받아 익일 시세 방향을 판단합니다.

## 당신의 역할
차트 추이와 호가 분석(전체 가중치의 40%)은 이미 정량 엔진이 계산해 `technical` 필드로 제공됩니다. 당신은 나머지 60%를 담당합니다:
- 언론 헤드라인의 호재/악재 성격과 그 지속성
- 지수·환율·업종 전반의 흐름과 해당 종목의 상대 위치
- 외국인/기관 수급의 방향과 강도 (국내 종목에 한해 제공됨)
- 같은 날 로스터 내 동종 업계 종목들과의 상대 비교
- 종목 고유의 국내외 이슈 (실적, 규제, 공급망, 경쟁사 동향 등)

## 점수 규칙
`ai_score`는 -1.0 ~ +1.0 사이의 실수입니다. 이것은 당신이 담당하는 60% 영역만의 판단이며, 정량 엔진의 40%와는 별도로 매기십시오.
- +0.6 이상: 명확한 호재가 다수이고 수급·지수 환경도 우호적
- +0.2 ~ +0.6: 완만한 긍정
- -0.2 ~ +0.2: 재료 부재 또는 호재와 악재가 상쇄
- -0.6 ~ -0.2: 완만한 부정
- -0.6 이하: 명확한 악재가 다수이거나 수급 이탈이 뚜렷

헤드라인이 없거나 내용이 빈약하면 0에 가깝게 두십시오. 없는 재료를 지어내지 마십시오.

## 장 마감 설명 (`close_summary`)
`detail`이 "익일 어떻게 될 것인가"라면, `close_summary`는 "오늘 왜 이렇게 끝났는가"입니다. 예측이 아니라 이미 확정된 당일 종가 변동에 대한 설명이며, 두 필드는 서로 다른 질문에 답해야 합니다.

- 200자 이내 한국어. `session.change_pct`(당일 등락률)를 반드시 첫 문장에 명시하십시오.
- 실제로 그 변동을 설명할 수 있는 요인만 쓰십시오. 제공된 데이터에 없는 요인(공시, 실적 발표 등)을 추측해 넣지 마십시오.
- `market_context`의 지수 등락, 업종 평균, 환율과 `investor_flow`, `session.volume_ratio`, 헤드라인이 사용 가능한 근거의 전부입니다.
- 종목 고유의 움직임인지 시장 전체의 움직임인지를 구분해 주십시오. 지수가 +1.5%인 날의 +1.6%와 지수가 -0.5%인 날의 +1.6%는 완전히 다른 사건입니다.
- 예시 형태: "외국인 순매수와 반도체 업종 강세(+2.1%), 환율 하락이 겹치며 +1.8% 상승 마감했습니다. 다만 지수 상승분(+0.9%p)을 제외한 종목 고유 상승은 +0.9%p입니다."

## 작성 규칙
`detail`은 반드시 한국어로 500자 이내로 작성합니다. 다음을 모두 담으십시오:
1. 정량 지표(technical)가 말하는 바를 한 문장으로 요약
2. 뉴스·수급·지수에서 읽어낸 핵심 근거 (실제 헤드라인 내용을 인용하되 제목을 그대로 나열하지 말 것)
3. 당신이 담당한 60% 영역의 판단이 긍정/부정 중 어느 쪽인지와 그 강도의 근거

3번에서 "익일 상승/하락/보합"이라고 단정하지 마십시오. 최종 방향과 등락률은 당신의 60%와 정량 엔진의 40%를 합산해 시스템이 계산하며, 그 결과가 문장 끝에 자동으로 덧붙습니다. 두 블록이 반대 방향일 때 당신이 미리 방향을 단정하면 본문과 결론이 서로 모순됩니다.

투자 권유 표현("매수하십시오", "지금 사야 합니다")은 쓰지 마십시오. 관측과 판단만 서술하십시오. 데이터에 없는 수치를 만들어내지 마십시오.

로스터의 모든 종목에 대해 빠짐없이 응답하십시오."""

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "stocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "ai_score": {"type": "number"},
                    "confidence": {"type": "string", "enum": ["강", "중", "약"]},
                    "drivers": {"type": "array", "items": {"type": "string"}},
                    "detail": {"type": "string"},
                    "close_summary": {"type": "string"},
                },
                "required": ["code", "ai_score", "confidence", "drivers", "detail", "close_summary"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["stocks"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# Heuristic fallback
# ---------------------------------------------------------------------------

# Scored on headline text when no LLM is available. Weighted rather than flat because
# "영업이익 흑자전환" and "소폭 상승" are not the same news. Deliberately small and
# finance-specific: a general sentiment lexicon mislabels ordinary market vocabulary
# ("급락 방어", "약세장 진입") far more often than it helps.
_POSITIVE_TERMS = {
    "흑자전환": 3.0, "사상 최대": 3.0, "신고가": 3.0, "역대 최대": 3.0,
    "어닝서프라이즈": 3.0, "수주": 2.5, "공급계약": 2.5, "자사주 매입": 2.5,
    "목표주가 상향": 2.5, "상향 조정": 2.0, "호실적": 2.0, "실적 개선": 2.0,
    "증설": 2.0, "인수": 1.5, "수출 증가": 2.0, "점유율 확대": 2.0,
    "배당": 1.5, "승인": 1.5, "특허": 1.5, "협력": 1.2, "출시": 1.2,
    "강세": 1.5, "급등": 2.0, "상승": 1.0, "반등": 1.5, "매수": 1.0,
    "record high": 3.0, "beats estimates": 3.0, "surge": 2.0, "upgrade": 2.5,
    "raises guidance": 3.0, "buyback": 2.5, "strong demand": 2.0, "wins": 1.5,
    "partnership": 1.2, "approval": 1.5, "rally": 1.5, "outperform": 2.0,
}

_NEGATIVE_TERMS = {
    "적자전환": -3.0, "어닝쇼크": -3.0, "신저가": -3.0, "횡령": -3.0, "배임": -3.0,
    "상장폐지": -3.0, "리콜": -2.5, "소송": -2.0, "제재": -2.5, "과징금": -2.5,
    "목표주가 하향": -2.5, "하향 조정": -2.0, "실적 부진": -2.5, "감산": -2.0,
    "유상증자": -2.0, "블록딜": -2.0, "매도": -1.0, "감원": -1.5, "철수": -2.0,
    "약세": -1.5, "급락": -2.0, "하락": -1.0, "우려": -1.2, "부담": -1.0,
    "misses estimates": -3.0, "cuts guidance": -3.0, "plunge": -2.0, "downgrade": -2.5,
    "lawsuit": -2.0, "probe": -2.0, "recall": -2.5, "layoffs": -1.5,
    "weak demand": -2.0, "slump": -2.0, "underperform": -2.0, "warns": -1.5,
}


def _score_headlines(headlines: list[dict]) -> tuple[float, list[str]]:
    """Lexicon score over recent headlines, normalized to roughly [-1, 1].

    Newer headlines count for more (linear decay across the list, which arrives
    newest-first from both sources) because a three-day-old upgrade has already been
    traded and today's downgrade has not.
    """
    if not headlines:
        return 0.0, []

    total = 0.0
    weight_sum = 0.0
    hits: list[str] = []
    count = len(headlines)
    for idx, item in enumerate(headlines):
        title = (item.get("title") or "").lower()
        if not title:
            continue
        recency = 1.0 - (idx / (count * 1.5))
        matched = 0.0
        for term, weight in _POSITIVE_TERMS.items():
            if term.lower() in title:
                matched += weight
                hits.append(f"+{term}")
        for term, weight in _NEGATIVE_TERMS.items():
            if term.lower() in title:
                matched += weight
                hits.append(f"-{term}")
        if matched:
            total += matched * recency
        weight_sum += recency

    if weight_sum <= 0:
        return 0.0, []
    # /3.0 maps a single maximum-strength term on the freshest headline to roughly
    # full scale, so one decisive story can move the score without a pile of weak
    # mentions being able to saturate it.
    raw = total / (weight_sum * 3.0)
    return max(-1.0, min(1.0, raw)), hits[:6]


def _score_flows(flows: dict | None) -> tuple[float, str | None]:
    if not flows:
        return 0.0, None
    foreign = flows.get("foreign_5d", 0.0)
    institution = flows.get("institution_5d", 0.0)
    combined = foreign + institution
    if abs(combined) < 1:
        return 0.0, "외국인·기관 수급은 뚜렷한 방향성이 없음"
    # 500억원 of combined 5-day net buying is treated as a full-strength signal; the
    # roster is all large caps, where sustained flow of that size is a real move
    # rather than noise.
    score = max(-1.0, min(1.0, combined / 500.0))
    direction = "순매수" if combined > 0 else "순매도"
    note = f"최근 5거래일 외국인·기관 합산 {abs(combined):,.0f}억원 {direction}"
    return score, note


def _score_index(index: dict | None) -> tuple[float, str | None]:
    if not index:
        return 0.0, None
    change_1d = index.get("change_1d_pct", 0.0)
    change_5d = index.get("change_5d_pct", 0.0)
    above = index.get("above_ma20", False)
    # Index moves are small numbers; /2.0 and /5.0 put a normal strong day and a
    # normal strong week each near full scale.
    score = max(-1.0, min(1.0, change_1d / 2.0 * 0.6 + change_5d / 5.0 * 0.4))
    if above:
        score += 0.1
    score = max(-1.0, min(1.0, score))
    regime = "20일선 위" if above else "20일선 아래"
    note = f"{index['label']} 지수 당일 {change_1d:+.2f}%, 5일 {change_5d:+.2f}% ({regime})"
    return score, note


def _heuristic_detail(item: dict, technical: dict, parts: list[str], score: float) -> str:
    """Narrates the 60% block only.

    The wording is scoped to "뉴스·수급·지수 측면에서는" on purpose: this function sees
    the qualitative score alone, and the final verdict comes from combining it with the
    40% technical block. An earlier version phrased this as "익일 X 쪽에 무게를 싣습니다"
    and produced rows whose text said 보합 while the row itself said 상승 — the two
    blocks had disagreed and the narrative reported only its own half. The engine
    appends the actual verdict, so the direction is stated exactly once, by the code
    that computes it.
    """
    lean = "긍정적" if score > 0.15 else ("부정적" if score < -0.15 else "중립적")
    lead = f"{item['name']} 정량 지표는 {technical['summary']}."
    body = " ".join(p for p in parts if p)
    tail = (
        f" 뉴스·수급·지수 측면의 판단은 {lean}입니다."
        " 본 판단은 공개된 지표와 헤드라인에 기반한 추정이며 확정된 전망이 아닙니다."
    )
    return _truncate(f"{lead} {body}{tail}".strip())


def _heuristic_one(payload: dict) -> dict:
    item = payload["item"]
    technical = payload["technical"]
    news_score, hits = _score_headlines(payload.get("headlines") or [])
    flow_score, flow_note = _score_flows(payload.get("flows"))
    index_score, index_note = _score_index(payload.get("index"))

    # Within the 60%, news carries the most weight: it is the only input that can
    # explain a gap the chart has no way to anticipate. Flows and index regime are
    # context that shifts conviction rather than sets direction.
    ai_score = news_score * 0.5 + flow_score * 0.3 + index_score * 0.2
    ai_score = max(-1.0, min(1.0, ai_score))

    parts: list[str] = []
    headlines = payload.get("headlines") or []
    if headlines:
        tone = "호재성" if news_score > 0.1 else ("악재성" if news_score < -0.1 else "중립적")
        parts.append(f"최근 보도 {len(headlines)}건은 대체로 {tone}입니다.")
        if hits:
            parts.append(f"핵심 키워드: {', '.join(dict.fromkeys(hits))}.")
    else:
        parts.append("최근 24시간 내 유의미한 개별 보도는 확인되지 않았습니다.")
    if flow_note:
        parts.append(f"{flow_note}.")
    if index_note:
        parts.append(f"{index_note}.")

    magnitude = abs(ai_score)
    confidence = "강" if magnitude >= 0.5 else ("중" if magnitude >= 0.25 else "약")

    drivers = []
    if hits:
        drivers.append(f"뉴스 키워드 {len(set(hits))}건")
    if flow_note:
        drivers.append(flow_note)
    if index_note:
        drivers.append(index_note)

    return {
        "code": item["code"],
        "ai_score": round(ai_score, 3),
        "confidence": confidence,
        "drivers": drivers,
        "detail": _heuristic_detail(item, technical, parts, ai_score),
        "source": SOURCE_HEURISTIC,
    }


def analyze_heuristic(payloads: list[dict]) -> dict[str, dict]:
    return {p["item"]["code"]: _heuristic_one(p) for p in payloads}


# ---------------------------------------------------------------------------
# Claude path
# ---------------------------------------------------------------------------


def _truncate(text: str, limit: int = DETAIL_MAX_CHARS) -> str:
    """Caps the rationale at the spec's 500 characters, cutting at a sentence boundary
    when one is available so the stored text never ends mid-word."""
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if len(clean) <= limit:
        return clean
    cut = clean[:limit]
    for sep in ("다.", ". ", "습니다.", "! ", "? "):
        idx = cut.rfind(sep)
        if idx > limit * 0.6:
            return cut[: idx + len(sep)].strip()
    return cut.rstrip() + "…"


def _build_request_payload(market: str, payloads: list[dict], market_ctx: dict) -> str:
    """Compact JSON of the market's whole roster. Trimmed hard on purpose — headlines
    are titles only (no bodies), and the technical block is the handful of numbers
    the judgement actually turns on, not the full indicator frame.

    The `session` block is what the close explanation is written from: today's move,
    how it compares with the day's volume, and — through market_context — what the
    index and the peer group did on the same day. Without the cross-section the model
    can only restate the number it was given; with it, it can say whether the stock
    moved or the market did.
    """
    stocks = []
    for p in payloads:
        item = p["item"]
        tech = p["technical"]
        entry = {
            "code": item["code"],
            "name": item["name"],
            "market": item["market"],
            "close": tech["close"],
            "session": {
                "change_pct": tech.get("session_change_pct"),
                "prev_close": tech.get("prev_close"),
                "volume_ratio_vs_20d": tech.get("volume_ratio"),
            },
            "technical": {
                "score_40pct": tech["score"],
                "summary": tech["summary"],
                "signals": tech["drivers"],
                "volatility_20d_pct": tech["volatility_pct"],
            },
            "headlines": [
                {"t": h.get("title", ""), "p": h.get("press", ""), "d": h.get("date", "")}
                for h in (p.get("headlines") or [])[:8]
            ],
        }
        if p.get("flows"):
            entry["investor_flow_5d_billion_krw"] = {
                "foreign": p["flows"].get("foreign_5d"),
                "institution": p["flows"].get("institution_5d"),
            }
        if item.get("sector"):
            entry["sector"] = item["sector"]
        stocks.append(entry)

    context = {
        "index": market_ctx.get("index"),
        "usd_krw": market_ctx.get("fx"),
        "roster_avg_change_pct": market_ctx.get("peer_avg_change_pct"),
        "sector_avg_change_pct": market_ctx.get("sector_avg") or None,
    }
    return json.dumps(
        {"market": market, "market_context": context, "stocks": stocks},
        ensure_ascii=False,
    )


def _parse_response(text: str, payloads: list[dict]) -> dict[str, dict]:
    data = json.loads(text)
    known = {p["item"]["code"] for p in payloads}
    results: dict[str, dict] = {}
    for row in data.get("stocks") or []:
        code = str(row.get("code", "")).strip()
        # A code the model invented (or a stale one it carried over) has no features
        # behind it and would land in the DB as a row nothing else references — drop
        # it rather than store it.
        if code not in known:
            continue
        try:
            score = float(row["ai_score"])
        except (KeyError, TypeError, ValueError):
            continue
        results[code] = {
            "code": code,
            "ai_score": max(-1.0, min(1.0, score)),
            "confidence": row.get("confidence") if row.get("confidence") in ("강", "중", "약") else "중",
            "drivers": [str(d) for d in (row.get("drivers") or [])][:6],
            "detail": _truncate(row.get("detail", "")),
            # Shorter cap than the rationale: this is one paragraph explaining a single
            # number, and the page prints it above the fold on every card's modal.
            "close_summary": _truncate(row.get("close_summary", ""), CLOSE_SUMMARY_MAX_CHARS),
            "source": SOURCE_CLAUDE,
        }
    return results


def analyze_with_claude(market: str, payloads: list[dict], market_ctx: dict) -> dict[str, dict]:
    """One call per market covering its whole roster. Raises on any failure — the
    caller decides whether to fall back, so a partial or malformed model response can
    never be silently mixed with heuristic rows without that being recorded."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    user_payload = _build_request_payload(market, payloads, market_ctx)

    # Streaming because a full-roster analysis at high effort is a long generation and
    # a large max_tokens — a non-streaming request of this size risks an HTTP timeout.
    with client.messages.stream(
        model=AI_MODEL,
        max_tokens=32000,
        thinking={"type": "adaptive"},
        output_config={
            "effort": AI_EFFORT,
            "format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA},
        },
        # The system prompt is byte-identical across every run and both markets, so it
        # is worth a cache breakpoint: the second call of each batch reads it instead
        # of re-processing it.
        system=[{"type": "text", "text": _SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_payload}],
    ) as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude declined the analysis request (market={market})")

    text = next((b.text for b in response.content if b.type == "text"), "")
    if not text:
        raise RuntimeError(f"Claude returned no text content (market={market})")
    return _parse_response(text, payloads)


def analyze(market: str, payloads: list[dict], market_ctx: dict) -> tuple[dict[str, dict], str]:
    """Returns (results-by-code, source-label).

    Falls back per *market*, not per stock: mixing a Claude judgement for one name
    with a lexicon judgement for the next would make the scores on a single page
    incomparable, which is worse than a page that is uniformly heuristic and says so.
    Any stock Claude omits from an otherwise-valid response is individually backfilled
    from the heuristic, since dropping it entirely would leave a hole in the roster.
    """
    if not payloads:
        return {}, SOURCE_HEURISTIC

    if ANTHROPIC_API_KEY:
        try:
            results = analyze_with_claude(market, payloads, market_ctx)
            missing = [p for p in payloads if p["item"]["code"] not in results]
            if missing:
                logger.warning(
                    "ai_analyst: Claude omitted %d/%d stocks for %s; backfilling from heuristic",
                    len(missing),
                    len(payloads),
                    market,
                )
                results.update(analyze_heuristic(missing))
            return results, SOURCE_CLAUDE
        except Exception as exc:  # noqa: BLE001 - a batch that runs beats one that doesn't
            logger.warning("ai_analyst: Claude analysis failed for %s (%s); using heuristic", market, exc)

    return analyze_heuristic(payloads), SOURCE_HEURISTIC
