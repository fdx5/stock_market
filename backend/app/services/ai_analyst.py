"""The 60% of the prediction that isn't chart mechanics.

The remaining 40% (trend + order book) is arithmetic on numbers this app already
collects — see prediction_engine. This module covers what that arithmetic can't see:
what the press is saying, how the index and the sector are behaving, whether foreign
and institutional money is behind the move, and how a name's situation compares with
its peers on the same day.

Three backends, one contract. Claude reads the whole market's roster in a single call
and returns a judgement per stock; a deterministic lexicon-and-macro engine produces
the same shape offline when no Claude access is configured. The batch runs either way —
Claude upgrades the quality of the 60%, it isn't a prerequisite for the pipeline
existing.

The Claude call has two billing paths, selected by PREDICTION_AI_BACKEND:
  - "api": the metered Anthropic API (ANTHROPIC_API_KEY), via the anthropic SDK.
  - "subscription": shells out to the Claude Code CLI, which bills a Claude Pro/Max
    subscription (CLAUDE_CODE_OAUTH_TOKEN) instead of API credits. The CLI takes the
    same schema (--json-schema) and system prompt (--system-prompt) as the SDK call,
    and runs with tools disabled, so it is the same request over a different meter —
    not a coding agent asked to do analysis on the side.
  - "heuristic": the offline engine, always available.
"auto" (the default) picks subscription when a subscription token is present, else the
API key, else the heuristic.

Claude sees the *whole market at once* rather than one stock per call, which is both
the cheaper shape and the better one: same-day peer comparison ("every memory name
here is bid, this one isn't") is only available to a reader who has the other rows in
front of them.
"""

import json
import logging
import os
import re
import shutil
import subprocess

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
# Overridable so the operator can trade quality for cost without editing code — this
# runs ~94 stocks a day (three market-cap top-30s plus the carried extras), split
# across two regional runs. Opus is the default because the judgement being asked for
# here (weighing conflicting headlines against a technical setup) is exactly the kind
# of call a weaker model gets confidently wrong.
AI_MODEL = os.environ.get("PREDICTION_AI_MODEL", "claude-opus-4-8")
# Thinking is billed as output, and at "high" over a 30-name roster it was the single
# largest line in the bill — comparable to the whole visible answer. "medium" is the
# default because the qualitative call here (is this headline material or noise?) is
# not the kind of problem that keeps improving with more deliberation, unlike the
# multi-step reasoning "high" is meant for. Raise it back per-market if the scores
# visibly degrade; that is cheaper to discover than to assume.
AI_EFFORT = os.environ.get("PREDICTION_AI_EFFORT", "medium")

# Whether Claude writes 장 마감 설명, or the deterministic composer does.
#
# Off by default, and this is the largest single saving in the module: at ~260자 a
# stock it was a fifth of the generated text, and prediction_quality already has
# compose_close_summary() producing the same paragraph from the same numbers — it was
# written as the omission fallback and prediction_engine already routes to it whenever
# the field comes back empty. Explaining a move that has *already happened* from
# figures the app holds is arithmetic with a sentence around it, not judgement, so
# paying an LLM for it buys phrasing rather than insight. Set to "1" to hand it back
# to Claude.
AI_CLOSE_SUMMARY = os.environ.get("PREDICTION_AI_CLOSE_SUMMARY", "").strip() in ("1", "true", "yes")

# Which billing path the Claude call takes: "api" | "subscription" | "heuristic" |
# "auto". See the module docstring; "auto" is resolved in _select_backend().
AI_BACKEND = os.environ.get("PREDICTION_AI_BACKEND", "auto").lower()
# The `claude` binary the subscription backend invokes. Resolved through shutil.which
# so a Windows dev box (where it's claude.cmd) works the same as the Linux container.
CLAUDE_CLI = os.environ.get("PREDICTION_CLAUDE_CLI", "claude")
# Opus over a full roster is a multi-minute generation; the subprocess must outlive it.
# Raised with the roster: at 10 names a market this was ten minutes of headroom over a
# generation that took two or three, and at 30 the same generation is three times the
# output. A timeout that expires mid-answer costs the whole market — it falls back to
# the heuristic — so the headroom is worth more here than a fast failure is.
AI_TIMEOUT = int(os.environ.get("PREDICTION_AI_TIMEOUT", "1800"))
# What `claude --effort` accepts. The API path's effort vocabulary is the same today,
# but it is the SDK's to change, so the CLI's is spelled out separately here.
_CLI_EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")

DETAIL_MAX_CHARS = 450
CLOSE_SUMMARY_MAX_CHARS = 260

# How many headlines per stock reach the model. Titles are over half the request
# payload, and the list arrives newest-first from both sources — the 6th-oldest
# headline on a name is nearly always a restatement of the first five or a story
# already priced in, so it costs tokens on every stock to change almost no judgement.
HEADLINES_PER_STOCK = 5
# Signals are ordered reversal → trend → momentum → band → volume → orderbook, so a
# cap keeps the short-term reversal read (the part with actual predictive sign) and
# drops the tail of confirmatory chart notes.
SIGNALS_PER_STOCK = 5

SOURCE_CLAUDE = "claude"
SOURCE_HEURISTIC = "heuristic"

_SYSTEM_PROMPT = """당신은 한국 증권사 리서치센터의 시니어 애널리스트입니다. 장 마감 직후 데이터를 받아 익일 시세 방향을 판단합니다.

## 반드시 먼저 읽을 것 — 이 시장의 익일 수익률 구조
3년·51,780 종목일 백테스트에서 확인된 사실입니다. 추측이 아니라 측정치입니다.

- **익일 수익률은 단기 평균회귀입니다.** 당일 등락률과 익일 등락률의 정보계수는 -0.028, 5일 모멘텀은 -0.020, 20일선 이격도는 -0.016입니다. 즉 **오늘 많이 오른 종목은 내일 되돌릴 확률이 근소하게 더 높습니다.**
- 반대로 추세추종 신호(20일선 상회, MACD 확대, 거래량 동반 상승)는 전부 음(-)의 정보계수였습니다. 차트가 좋아 보인다는 이유로 상승을 예측하면 장기적으로 손해입니다.
- 따라서 **오늘의 등락을 내일로 연장 추정하지 마십시오.** "오늘 급등했으니 상승 흐름이 이어질 것"은 이 데이터에서 반증된 논리입니다. `technical` 필드의 정량 점수는 이미 이 평균회귀 구조를 반영해 계산되어 있습니다.
- 다만 이 효과는 매우 약합니다(익일 방향 적중 기대치 50~52%). 확신에 찬 표현을 쓰지 마십시오.

당신이 기여할 수 있는 부분은 **가격 시계열에 아직 반영되지 않은 정보**입니다. 실적·공시·규제·수급 이탈처럼 평균회귀를 뒤집을 만한 실제 사건이 있을 때만 큰 점수를 주십시오. 그런 재료가 없다면 0 근처가 정답입니다.

## 당신의 역할
차트 추이와 호가 분석(전체 가중치의 55%)은 이미 정량 엔진이 계산해 `technical` 필드로 제공됩니다. 당신은 나머지 45%를 담당합니다:
- 언론 헤드라인의 호재/악재 성격과 그 지속성
- 지수·환율·업종 전반의 흐름과 해당 종목의 상대 위치
- 외국인/기관 수급의 방향과 강도 (국내 종목에 한해 제공됨)
- 같은 날 로스터 내 동종 업계 종목들과의 상대 비교
- 종목 고유의 국내외 이슈 (실적, 규제, 공급망, 경쟁사 동향 등)

## 점수 규칙
`ai_score`는 -1.0 ~ +1.0 사이의 실수입니다. 이것은 당신이 담당하는 45% 영역만의 판단이며, 정량 엔진의 55%와는 별도로 매기십시오.
- +0.6 이상: 명확한 호재가 다수이고 수급·지수 환경도 우호적
- +0.2 ~ +0.6: 완만한 긍정
- -0.2 ~ +0.2: 재료 부재 또는 호재와 악재가 상쇄
- -0.6 ~ -0.2: 완만한 부정
- -0.6 이하: 명확한 악재가 다수이거나 수급 이탈이 뚜렷

헤드라인이 없거나 내용이 빈약하면 0에 가깝게 두십시오. 없는 재료를 지어내지 마십시오.

## 작성 규칙 — 분량을 재료에 맞추십시오
`detail`은 한국어로 작성하되, **길이는 실제로 할 말이 있는 만큼만** 쓰십시오. 분량을 채우려고 쓰지 마십시오.

- **판단을 바꿀 재료가 있는 종목**(실적·공시·규제·수급 이탈·뚜렷한 뉴스): **250~400자**
- **재료가 없는 종목**(헤드라인 부재 또는 무의미, 수급 중립): **80~150자**. "특이 재료 없음"을 짧게 쓰고 끝내는 것이 정답입니다. 대다수 종목은 여기에 해당합니다.

담을 내용은 다음 세 가지뿐입니다:

1. **뉴스** — 재료의 성격(일회성인지 지속성인지), 이미 주가에 반영됐다고 보는지. 없으면 없다고 한 문장.
2. **동종 업계 상대 비교** — 같은 로스터의 동종 종목 대비 앞서는지 뒤처지는지. 비교 대상이 없으면 생략.
3. **리스크 요인** — 이 판단이 틀릴 수 있는 가장 큰 이유 하나. 생략하지 마십시오 — 반증 조건이 없는 예측은 근거가 아니라 주장입니다.

**다음은 쓰지 마십시오. 시스템이 이미 갖고 있어 중복이고, 화면에는 별도로 표시됩니다:**
- `technical`의 `summary`·`score_40pct`·`signals` 재진술
- 당일 등락률, 수급 금액, 지수·환율 수치의 나열 — 그 숫자가 당신의 판단을 실제로 바꾼 경우에만 한 번 인용하십시오
- 서론("~를 살펴보면"), 맺음말("종합하면"), 면책 문구

수치는 제공된 데이터에서만 인용하고, 없는 숫자를 만들어내지 마십시오. 투자 권유 표현("매수하십시오")은 쓰지 마십시오.

"익일 상승/하락/보합"이라고 단정하지 마십시오. 최종 방향과 등락률은 당신의 45%와 정량 엔진의 55%를 합산해 시스템이 계산하며, 그 결과가 문장 끝에 자동으로 덧붙습니다. 두 블록이 반대 방향일 때 당신이 미리 방향을 단정하면 본문과 결론이 서로 모순됩니다.

`drivers`는 최대 3개, 각 20자 이내의 핵심 근거 키워드입니다. `detail`의 요약이 아닙니다.

로스터의 모든 종목에 대해 빠짐없이 응답하십시오."""

# Appended to the system prompt only when AI_CLOSE_SUMMARY is on. Kept separate so the
# default path doesn't pay for instructions describing a field it never asks for.
_CLOSE_SUMMARY_PROMPT = """

## 장 마감 설명 (`close_summary`)
`detail`이 "익일 어떻게 될 것인가"라면, `close_summary`는 "오늘 왜 이렇게 끝났는가"입니다. 예측이 아니라 이미 확정된 당일 종가 변동에 대한 설명이며, 두 필드는 서로 다른 질문에 답해야 합니다.

- 200자 이내 한국어. `session.change_pct`(당일 등락률)를 반드시 첫 문장에 명시하십시오.
- 실제로 그 변동을 설명할 수 있는 요인만 쓰십시오. 제공된 데이터에 없는 요인(공시, 실적 발표 등)을 추측해 넣지 마십시오.
- `market_context`의 지수 등락, 업종 평균, 환율과 `investor_flow`, `session.volume_ratio`, 헤드라인이 사용 가능한 근거의 전부입니다.
- 종목 고유의 움직임인지 시장 전체의 움직임인지를 구분해 주십시오. 지수가 +1.5%인 날의 +1.6%와 지수가 -0.5%인 날의 +1.6%는 완전히 다른 사건입니다."""

# Both backends pin the shape with a schema (output_config for the API, --json-schema
# for the CLI). The CLI path additionally states it in the prompt: schema enforcement
# there is a flag on a wrapper rather than a documented API guarantee, and a run that
# quietly ignored it would cost a whole market's analysis.
_JSON_INSTRUCTION = """반드시 아래 형식의 JSON 객체 하나만 출력하십시오. 코드블록 표시(```), 머리말, 설명 문장 없이 순수 JSON만 반환하십시오.

{"stocks": [{"code": "종목코드", "ai_score": -1.0~1.0 사이 실수, "confidence": "강" 또는 "중" 또는 "약", "drivers": ["핵심 근거", ...], "detail": "근거 서술"%s}, ...]}

로스터의 모든 종목을 stocks 배열에 빠짐없이 포함하십시오."""

_CLOSE_SUMMARY_FIELD = ', "close_summary": "당일 종가 변동 설명"'


def _system_prompt() -> str:
    return _SYSTEM_PROMPT + (_CLOSE_SUMMARY_PROMPT if AI_CLOSE_SUMMARY else "")


def _json_instruction() -> str:
    return _JSON_INSTRUCTION % (_CLOSE_SUMMARY_FIELD if AI_CLOSE_SUMMARY else "")


def _output_schema() -> dict:
    """Built per call rather than as a constant because the close_summary field is
    optional: a schema that still requires it would force the model to generate the
    paragraph even with every instruction to write it removed."""
    properties = {
        "code": {"type": "string"},
        "ai_score": {"type": "number"},
        "confidence": {"type": "string", "enum": ["강", "중", "약"]},
        "drivers": {"type": "array", "items": {"type": "string"}},
        "detail": {"type": "string"},
    }
    if AI_CLOSE_SUMMARY:
        properties["close_summary"] = {"type": "string"}
    return {
        "type": "object",
        "properties": {
            "stocks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": properties,
                    "required": list(properties),
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
    # limit - 1, because the ellipsis is a character too. Cutting at `limit` and then
    # appending returned limit + 1 and quietly broke every caller that had budgeted
    # exact room for something after the truncated text.
    return clean[: max(0, limit - 1)].rstrip() + "…"


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
                # prev_close is dropped: it is close ÷ (1 + change_pct), so sending it
                # spends tokens on every stock to restate a number already present.
                "change_pct": tech.get("session_change_pct"),
                "volume_ratio_vs_20d": tech.get("volume_ratio"),
            },
            "technical": {
                "score_40pct": tech["score"],
                "summary": tech["summary"],
                "signals": tech["drivers"][:SIGNALS_PER_STOCK],
                "volatility_20d_pct": tech["volatility_pct"],
            },
            # Title and date only. The press name was costing ~5 characters a headline
            # across the whole roster and never changed a judgement — whether a story
            # is material is a property of the story, and the model was told not to
            # weight outlets against each other anyway. The date stays because
            # recency is what separates a live catalyst from one already traded.
            "headlines": [
                {"t": h.get("title", ""), "d": h.get("date", "")}
                for h in (p.get("headlines") or [])[:HEADLINES_PER_STOCK]
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
            "drivers": [str(d) for d in (row.get("drivers") or [])][:3],
            "detail": _truncate(row.get("detail", "")),
            # Absent when AI_CLOSE_SUMMARY is off, and empty is the contract that makes
            # that work: prediction_engine reads a blank close_summary as "compose it
            # from the numbers" and calls prediction_quality. Shorter cap than the
            # rationale when Claude does write it — one paragraph explaining a single
            # number, printed above the fold on every card's modal.
            "close_summary": _truncate(row.get("close_summary", ""), CLOSE_SUMMARY_MAX_CHARS),
            "source": SOURCE_CLAUDE,
        }
    return results


def _normalize_usage(raw: dict | None, **extra) -> dict:
    """One shape for both billing paths, so the batch summary reads the same whether
    the run went through the metered API or the subscription CLI."""
    raw = raw or {}
    usage = {
        key: int(raw.get(key) or 0)
        for key in (
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        )
    }
    usage["total_tokens"] = sum(usage.values())
    usage.update({k: v for k, v in extra.items() if v is not None})
    return usage


def analyze_with_claude(market: str, payloads: list[dict], market_ctx: dict) -> tuple[dict[str, dict], dict]:
    """One call per market covering its whole roster. Raises on any failure — the
    caller decides whether to fall back, so a partial or malformed model response can
    never be silently mixed with heuristic rows without that being recorded.

    Returns (results-by-code, usage)."""
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    user_payload = _build_request_payload(market, payloads, market_ctx)

    # Streaming because a full-roster analysis is a long generation and a large
    # max_tokens — a non-streaming request of this size risks an HTTP timeout.
    with client.messages.stream(
        model=AI_MODEL,
        # Headroom, not a target. Unused max_tokens is not billed, but a body that
        # truncates mid-JSON fails the parse and costs the whole market — so this
        # stays well above the ~15k the trimmed roster now generates rather than
        # being re-sized down alongside it.
        max_tokens=64000,
        thinking={"type": "adaptive"},
        output_config={
            "effort": AI_EFFORT,
            "format": {"type": "json_schema", "schema": _output_schema()},
        },
        # The system prompt is byte-identical across every run and both markets, so it
        # is worth a cache breakpoint: the second call of each batch reads it instead
        # of re-processing it.
        system=[{"type": "text", "text": _system_prompt(), "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_payload}],
    ) as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude declined the analysis request (market={market})")

    text = next((b.text for b in response.content if b.type == "text"), "")
    if not text:
        raise RuntimeError(f"Claude returned no text content (market={market})")

    usage = _normalize_usage(
        response.usage.model_dump() if hasattr(response.usage, "model_dump") else dict(response.usage or {}),
        stop_reason=response.stop_reason,
    )
    return _parse_response(text, payloads), usage


# ---------------------------------------------------------------------------
# Claude subscription path (Claude Code CLI)
# ---------------------------------------------------------------------------


def _resolve_claude_cli() -> str:
    resolved = shutil.which(CLAUDE_CLI)
    if not resolved:
        raise RuntimeError(
            f"'{CLAUDE_CLI}' 실행 파일을 찾을 수 없습니다. Claude Code CLI가 설치돼 있고 "
            "CLAUDE_CODE_OAUTH_TOKEN이 설정됐는지 확인하십시오."
        )
    return resolved


# Any credential of this family is base64url-ish: no whitespace is ever legal inside
# one, which is what makes both stripping and matching them unambiguous.
_SECRET_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]+")


def _redact(text: str) -> str:
    """Removes credentials from CLI output before it is stored or displayed.

    This is not hypothetical tidiness: the CLI echoes the offending header value back
    when the token is malformed, and that string travels into the run's warnings —
    which the admin panel renders and the GitHub Actions workflow prints into its log.
    A token that reaches a build log has to be treated as disclosed.

    Literal replacement of the known env values comes first because it catches a
    mangled token the pattern can't (a stray newline inside one splits it in two); the
    regex is the backstop for anything else of the same shape.
    """
    out = text
    for name in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"):
        value = os.environ.get(name)
        if not value or len(value.strip()) < 8:
            continue
        out = out.replace(value, f"<{name}>")
        compact = "".join(value.split())
        if compact != value:
            out = out.replace(compact, f"<{name}>")
    return _SECRET_RE.sub("sk-ant-<redacted>", out)


def _extract_json(text: str) -> str:
    """Pulls the JSON object out of the CLI's free-text answer.

    Without output_config's json_schema the model occasionally wraps its answer in a
    ```json fence or a sentence of preamble despite the instruction. Strip the fence,
    then take the outermost brace pair — _parse_response does the real validation."""
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise RuntimeError("Claude 응답에서 JSON 객체를 찾지 못했습니다")
    return s[start : end + 1]


def analyze_with_claude_subscription(
    market: str, payloads: list[dict], market_ctx: dict
) -> tuple[dict[str, dict], dict]:
    """Same contract as analyze_with_claude, but routed through the Claude Code CLI so
    the call bills a Claude subscription (CLAUDE_CODE_OAUTH_TOKEN) rather than API
    credits. Raises on any failure so the caller falls back per-market exactly as it
    does for the API path.

    Returns (results-by-code, usage).

    The whole prompt is passed as one argv entry (subprocess with a list, no shell), so
    the Korean text and the roster JSON need no escaping and can't be misread as flags.
    ~50KB is far under ARG_MAX."""
    cli = _resolve_claude_cli()
    prompt = "\n\n".join(
        [
            "다음은 분석 대상 데이터입니다:",
            _build_request_payload(market, payloads, market_ctx),
            _json_instruction(),
        ]
    )

    # A subscription-authed run must not silently fall back to metered API billing —
    # which is exactly what a stray ANTHROPIC_API_KEY would cause, since Claude Code
    # prefers the key over the OAuth token. Drop it for this subprocess only.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}

    # A token pasted into a hosting dashboard routinely arrives with a newline or
    # trailing space picked up from the terminal line-wrap it was copied out of. The
    # CLI forwards the value verbatim into an Authorization header, where whitespace is
    # fatal — the request dies with "Header '14' has invalid value" before it ever
    # reaches Anthropic, and the whole market falls back to the heuristic. No token of
    # this shape legitimately contains whitespace, so removing it repairs the paste
    # instead of failing a batch over one invisible character.
    token = env.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = "".join(token.split())

    # --system-prompt *replaces* Claude Code's own agent preamble rather than appending
    # to it, and --tools "" leaves the model nothing to call. Together they turn the CLI
    # into a plain one-shot completion on subscription billing: no tool descriptions, no
    # repo context from the container's cwd, nothing to make this read differently from
    # the API path. --no-session-persistence keeps a twice-daily batch from accumulating
    # transcripts in the container's HOME.
    cmd = [
        cli,
        "-p",
        prompt,
        "--system-prompt",
        _system_prompt(),
        "--tools",
        "",
        "--json-schema",
        json.dumps(_output_schema()),
        "--output-format",
        "json",
        "--model",
        AI_MODEL,
        "--no-session-persistence",
    ]
    # Shared with the API path, but the CLI validates the value up front and exits
    # non-zero on an unknown one — so a typo'd env var would take the whole market
    # down to the heuristic. Pass it only when it is one of the levels the CLI accepts.
    if AI_EFFORT in _CLI_EFFORT_LEVELS:
        cmd += ["--effort", AI_EFFORT]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=AI_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"claude CLI가 {AI_TIMEOUT}s 내에 응답하지 않음 (market={market})") from exc

    if proc.returncode != 0:
        detail = _redact((proc.stderr or proc.stdout or "").strip())[:500]
        raise RuntimeError(f"claude CLI 실패 (rc={proc.returncode}, market={market}): {detail}")

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"claude CLI가 JSON 봉투를 반환하지 않음 (market={market}): {_redact(proc.stdout)[:300]}"
        ) from exc

    # A non-zero exit is not the only failure mode: the CLI reports auth and API errors
    # inside a rc=0 envelope with is_error set, which is how a malformed token surfaces.
    if envelope.get("is_error"):
        detail = _redact(str(envelope.get("result") or envelope.get("subtype")))[:500]
        raise RuntimeError(f"claude CLI가 오류를 반환함 (market={market}): {detail}")

    text = envelope.get("result", "")
    if not text:
        raise RuntimeError(f"claude CLI 응답에 result 텍스트가 없음 (market={market})")

    # The envelope carries what the run actually cost, and until now this function
    # read `result` and threw the rest away — which is why the only way to size a
    # batch was to estimate it from character counts. `total_cost_usd` is the CLI's
    # own list-price figure and is informational on a subscription (the run bills
    # against the plan's window, not a dollar balance), but it is the one number that
    # makes two configurations directly comparable.
    usage = _normalize_usage(
        envelope.get("usage"),
        cost_usd=envelope.get("total_cost_usd"),
        duration_ms=envelope.get("duration_ms"),
        num_turns=envelope.get("num_turns"),
    )
    return _parse_response(_extract_json(text), payloads), usage


def _select_backend() -> str:
    if AI_BACKEND in ("subscription", "api", "heuristic"):
        return AI_BACKEND
    # auto: a subscription token wins over an API key, so a box that happens to have
    # both configured doesn't quietly pay per-token when the operator meant to use the
    # flat-rate subscription.
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return "subscription"
    if ANTHROPIC_API_KEY:
        return "api"
    return "heuristic"


def analyze(
    market: str, payloads: list[dict], market_ctx: dict
) -> tuple[dict[str, dict], str, str | None, dict | None]:
    """Returns (results-by-code, source-label, failure-reason, usage).

    Falls back per *market*, not per stock: mixing a Claude judgement for one name
    with a lexicon judgement for the next would make the scores on a single page
    incomparable, which is worse than a page that is uniformly heuristic and says so.
    Any stock Claude omits from an otherwise-valid response is individually backfilled
    from the heuristic, since dropping it entirely would leave a hole in the roster.

    The third element is the exception text when the Claude path was attempted and
    failed, and None otherwise. It exists because the fallback is deliberately silent
    to the caller — the batch keeps running and reports success — so without carrying
    the reason out, diagnosing a misconfiguration meant reading the server's own log
    on the host. The batch puts this string straight into its warnings, which reach
    the cron output and the admin panel.

    The fourth is what the call consumed, and None on the heuristic path (which
    consumes nothing). It travels the same route as the reason for the same purpose:
    the operator cannot see this process, so anything they need to know about a run
    has to ride out on its summary.
    """
    if not payloads:
        return {}, SOURCE_HEURISTIC, None, None

    backend = _select_backend()
    if backend in ("subscription", "api"):
        runner = analyze_with_claude_subscription if backend == "subscription" else analyze_with_claude
        try:
            results, usage = runner(market, payloads, market_ctx)
            missing = [p for p in payloads if p["item"]["code"] not in results]
            if missing:
                logger.warning(
                    "ai_analyst: Claude(%s) omitted %d/%d stocks for %s; backfilling from heuristic",
                    backend,
                    len(missing),
                    len(payloads),
                    market,
                )
                results.update(analyze_heuristic(missing))
            logger.info(
                "ai_analyst: %s %s in=%d out=%d cache_read=%d total=%d",
                backend,
                market,
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
                usage.get("cache_read_input_tokens", 0),
                usage.get("total_tokens", 0),
            )
            return results, SOURCE_CLAUDE, None, usage
        except Exception as exc:  # noqa: BLE001 - a batch that runs beats one that doesn't
            logger.warning(
                "ai_analyst: Claude(%s) analysis failed for %s (%s); using heuristic", backend, market, exc
            )
            return analyze_heuristic(payloads), SOURCE_HEURISTIC, f"{type(exc).__name__}: {exc}", None

    return analyze_heuristic(payloads), SOURCE_HEURISTIC, None, None
