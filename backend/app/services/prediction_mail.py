"""Per-stock prediction emails.

One stock, one mail. Not a digest: a digest is skimmed once and deleted, whereas a
mail whose subject already names the stock and the call is something a reader can file
per name and come back to when that stock's session closes. The batch is built around
a watchlist for that reason rather than around the whole roster.

Everything in the body comes from the stored prediction row — the same row the page
renders and the grader later scores. Nothing is recomputed here, so a mail can never
describe a different call than the site does for the same 예측일자.

Two transports, chosen by whichever is configured (see `backend_name`): a
transactional-mail API key, or SMTP. With neither set `is_configured()` is False and
the batch reports that instead of half-sending. See PREDICTION_MAIL_* below.
"""

from __future__ import annotations

import datetime as dt
import html
import logging
import os
import smtplib
import ssl
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

import requests

from app.services import (
    mail_subscription_store,
    prediction_engine,
    prediction_grader,
    prediction_store,
)
from app.services import trading_calendar as cal

logger = logging.getLogger(__name__)

# Two ways to send, and the API one is preferred where it is configured.
#
# SMTP means authenticating as a mailbox owner, which for a personal Naver or Gmail
# account means putting a credential to that whole account into a deployed service's
# environment. An app password narrows the blast radius but is still an account
# credential. A transactional-mail API key is scoped to one verb — send this message —
# and is revoked and reissued without touching anything else, which is the right shape
# for a secret that has to live on a server.
#
# SMTP is kept rather than replaced: it needs no third-party signup, and it is the
# only option if the sender must be a specific existing mailbox.
RESEND_API_KEY = os.environ.get("PREDICTION_MAIL_RESEND_KEY")
RESEND_ENDPOINT = "https://api.resend.com/emails"
# Resend's shared sender, usable with no domain set up at all. It can only deliver to
# the address the Resend account itself was registered with — which is exactly the
# case here (the reader is mailing themselves), so the whole domain-verification step
# is skippable until a second recipient appears.
RESEND_DEFAULT_FROM = "onboarding@resend.dev"
# The API sender, resolved separately from the SMTP one and deliberately NOT falling
# back to SMTP_USER. SMTP_USER is the mailbox you authenticate to an SMTP server as,
# which means nothing to an API that authenticates by key — and handing Resend a
# naver.com or gmail.com address it has no proof you own is a guaranteed rejection.
# Someone who really wants a custom sender sets PREDICTION_MAIL_FROM and verifies that
# domain with Resend first; everyone else gets the shared sender, which just works.
RESEND_FROM = os.environ.get("PREDICTION_MAIL_FROM") or RESEND_DEFAULT_FROM

SMTP_HOST = os.environ.get("PREDICTION_MAIL_SMTP_HOST", "smtp.naver.com")
SMTP_PORT = int(os.environ.get("PREDICTION_MAIL_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("PREDICTION_MAIL_USER")
SMTP_PASSWORD = os.environ.get("PREDICTION_MAIL_PASSWORD")
# Most providers reject a From that isn't the authenticated mailbox, so this defaults
# to the login rather than to a friendly-looking address that would silently bounce.
MAIL_FROM = os.environ.get("PREDICTION_MAIL_FROM") or SMTP_USER
MAIL_FROM_NAME = os.environ.get("PREDICTION_MAIL_FROM_NAME", "K-Stock Hub 예측")
# No default recipient. A personal address is not configuration to be baked into a
# public repository — it belongs in the environment beside the credentials, and with
# nothing set the batch says so rather than mailing a stale hard-coded address.
MAIL_TO = os.environ.get("PREDICTION_MAIL_TO")
# 465 is implicit TLS (SMTPS); 587 is STARTTLS. Choosing on the port rather than on a
# second flag keeps one setting instead of two that can contradict each other.
USE_SSL = SMTP_PORT == 465

SITE_URL = "https://kospi-predictor.onrender.com"

# The default watchlist. Codes, not names — a name is a display label that changes
# (mergers, renames) while the code is what every table here is keyed by.
DEFAULT_WATCHLIST = ("005930", "000660", "402340", "MU", "005380")

DIRECTION_COLOR = {"상승": "#c0392b", "하락": "#1f6fb2", "보합": "#6b7280"}
IMPACT_LABEL = {"positive": "긍정", "negative": "부정", "neutral": "중립"}
IMPACT_COLOR = {"positive": "#c0392b", "negative": "#1f6fb2", "neutral": "#6b7280"}


class MailNotConfigured(RuntimeError):
    """Raised rather than returning a soft failure: a batch that reports success while
    sending nothing is worse than one that stops."""


def backend_name() -> str | None:
    """Which transport will actually be used, or None if neither is configured.

    Reported to the admin panel so an operator can see *how* mail is going out, not
    just that it can — the two have very different failure modes and the panel is the
    only place that distinction is visible.
    """
    if RESEND_API_KEY:
        return "resend"
    if SMTP_USER and SMTP_PASSWORD and MAIL_FROM:
        return "smtp"
    return None


def is_configured() -> bool:
    return backend_name() is not None


def mask_address(addr: str | None) -> str:
    """`someone@example.com` -> `s*****e@example.com`.

    Subscriber addresses must not leave this module in readable form. The batch report
    is printed to a terminal, returned from an HTTP endpoint and written to whatever
    log aggregator is attached, and an address that is readable in any one of those is
    an address that has left the system — so it is masked at the single point every
    one of those paths reads it from, not at each of them.

    Enough of the address survives to tell two configured recipients apart while
    debugging, which is the only reason anything survives at all.
    """
    if not addr or "@" not in addr:
        return "(미설정)"
    local, _, domain = addr.partition("@")
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


# ---------------------------------------------------------------------------
# formatting helpers
# ---------------------------------------------------------------------------

def _esc(value) -> str:
    return html.escape("" if value is None else str(value))


def _pct(value, digits: int = 2) -> str:
    return "-" if value is None else f"{float(value):+.{digits}f}%"


def _price(value, market: str) -> str:
    if value is None:
        return "-"
    value = float(value)
    return f"${value:,.2f}" if market == "NASDAQ" else f"{value:,.0f}원"


def _date_label(key: str) -> str:
    try:
        d = cal.from_key(key)
    except Exception:  # noqa: BLE001 - a malformed key must not lose the whole mail
        return key
    return f"{d.year}년 {d.month}월 {d.day}일 ({'월화수목금토일'[d.weekday()]})"


def _accuracy_cell(window: dict | None) -> str:
    if not window or not window.get("total"):
        return "기록 없음"
    rate = window.get("rate")
    return f"{rate}% ({window['hit']}/{window['total']})" if rate is not None else "기록 없음"


# ---------------------------------------------------------------------------
# body
# ---------------------------------------------------------------------------

_TABLE = (
    "border-collapse:collapse;width:100%;font-size:13px;"
    "border:1px solid #e2e5ea;margin:0 0 18px"
)
_TH = (
    "padding:8px 10px;background:#f5f6f8;border:1px solid #e2e5ea;"
    "text-align:left;font-weight:600;color:#4b5563;white-space:nowrap"
)
_TD = "padding:8px 10px;border:1px solid #e2e5ea;color:#111827"
_H2 = "margin:26px 0 10px;font-size:15px;font-weight:700;color:#111827"


def _headline_table(row: dict) -> str:
    market = row["market"]
    color = DIRECTION_COLOR.get(row["result"], "#111827")
    return f"""
<table style="{_TABLE}">
  <tr><th style="{_TH}" width="140">예측 방향</th>
      <td style="{_TD}"><b style="color:{color};font-size:16px">{_esc(row['result'])}</b>
      &nbsp;<b style="color:{color}">{_pct(row['change_rate'])}</b></td></tr>
  <tr><th style="{_TH}">기준 종가</th><td style="{_TD}">{_price(row['base_price'], market)}
      <span style="color:#6b7280">({_esc(row['collect_date'] and _date_label(row['collect_date']))} 종가)</span></td></tr>
  <tr><th style="{_TH}">예측 시세</th><td style="{_TD}"><b>{_price(row['predict_price'], market)}</b></td></tr>
  <tr><th style="{_TH}">확신도</th><td style="{_TD}">{_esc(row['confidence'])}</td></tr>
  <tr><th style="{_TH}">신뢰도</th><td style="{_TD}">{_esc(row.get('reliability_grade') or '-')}
      ({_esc(row.get('reliability'))}점)</td></tr>
  <tr><th style="{_TH}">보합 판정 밴드</th><td style="{_TD}">&plusmn;{_esc(row.get('flat_band'))}%
      <span style="color:#6b7280">— 이 범위 안에서 끝나면 보합으로 채점됩니다</span></td></tr>
</table>"""


def _probability_table(row: dict) -> str:
    def bar(label: str, value, color: str) -> str:
        v = float(value or 0)
        return f"""
  <tr><th style="{_TH}" width="140">{label}</th>
      <td style="{_TD}">
        <table style="border-collapse:collapse;width:100%"><tr>
          <td width="46" style="font-weight:700;color:{color}">{v:.0f}%</td>
          <td><div style="background:#eef0f3;height:10px;border-radius:5px">
            <div style="background:{color};width:{max(1.0, v):.0f}%;height:10px;border-radius:5px"></div>
          </div></td>
        </tr></table>
      </td></tr>"""

    return f"""
<table style="{_TABLE}">
  {bar('상승 확률', row.get('prob_up'), '#c0392b')}
  {bar('보합 확률', row.get('prob_flat'), '#6b7280')}
  {bar('하락 확률', row.get('prob_down'), '#1f6fb2')}
</table>"""


def _evidence_table(row: dict) -> str:
    evidence = row.get("evidence") or []
    if not evidence:
        return '<p style="color:#6b7280;font-size:13px">근거 데이터가 기록되지 않았습니다.</p>'
    body = "".join(
        f"""
  <tr>
    <td style="{_TD};white-space:nowrap;color:#4b5563">{_esc(e.get('category'))}</td>
    <td style="{_TD};white-space:nowrap">{_esc(e.get('label'))}</td>
    <td style="{_TD}">{_esc(e.get('value'))}</td>
    <td style="{_TD};white-space:nowrap;color:{IMPACT_COLOR.get(e.get('impact'), '#6b7280')}">
      {IMPACT_LABEL.get(e.get('impact'), '-')}</td>
  </tr>"""
        for e in evidence
    )
    return f"""
<table style="{_TABLE}">
  <tr><th style="{_TH}">구분</th><th style="{_TH}">항목</th>
      <th style="{_TH}">값</th><th style="{_TH}">영향</th></tr>
  {body}
</table>"""


def _accuracy_table(acc: dict | None) -> str:
    if not acc:
        return '<p style="color:#6b7280;font-size:13px">아직 채점된 예측이 없습니다.</p>'
    return f"""
<table style="{_TABLE}">
  <tr><th style="{_TH}">최근 20거래일</th><th style="{_TH}">최근 60거래일</th><th style="{_TH}">전체</th></tr>
  <tr><td style="{_TD}">{_accuracy_cell(acc.get('recent20'))}</td>
      <td style="{_TD}">{_accuracy_cell(acc.get('recent60'))}</td>
      <td style="{_TD}">{_accuracy_cell(acc.get('all'))}</td></tr>
</table>"""


def _last_result_block(history: list[dict]) -> str:
    """The most recently graded call for this stock. A forecast mail that never shows
    how the last one turned out is marketing; this is the part that makes it a record."""
    graded = next((h for h in history if h.get("actual_result")), None)
    if not graded:
        return ""
    ok = bool(graded.get("hit"))
    mark = "적중" if ok else "실패"
    color = "#1a7f45" if ok else "#b3261e"
    return f"""
<h2 style="{_H2}">직전 예측 결과</h2>
<table style="{_TABLE}">
  <tr><th style="{_TH}" width="140">{_esc(_date_label(graded['predict_date']))}</th>
      <td style="{_TD}">예측 <b>{_esc(graded['result'])}</b> {_pct(graded['change_rate'])}
      &nbsp;&rarr;&nbsp; 실제 <b>{_esc(graded['actual_result'])}</b> {_pct(graded['actual_change_rate'])}
      &nbsp;<b style="color:{color}">[{mark}]</b></td></tr>
</table>"""


def build_html(row: dict, acc: dict | None, history: list[dict]) -> str:
    market = row["market"]
    color = DIRECTION_COLOR.get(row["result"], "#111827")
    notes = row.get("reliability_notes") or []
    notes_html = (
        "<ul style='margin:6px 0 18px;padding-left:18px;color:#6b7280;font-size:12.5px'>"
        + "".join(f"<li>{_esc(n)}</li>" for n in notes)
        + "</ul>"
        if notes
        else ""
    )
    return f"""<div style="font-family:'Malgun Gothic',AppleSDGothicNeo-Regular,sans-serif;
     max-width:720px;margin:0 auto;padding:24px;color:#111827;background:#ffffff">
  <p style="margin:0 0 4px;font-size:12px;color:#6b7280;letter-spacing:.04em">K-STOCK HUB · AI 종목예측</p>
  <h1 style="margin:0 0 2px;font-size:22px">{_esc(row['name'])}
    <span style="font-size:14px;color:#6b7280">({_esc(row['code'])} · {_esc(market)})</span></h1>
  <p style="margin:0 0 20px;font-size:13px;color:#4b5563">
    <b>{_esc(_date_label(row['predict_date']))}</b> 세션 예측 ·
    <span style="color:{color};font-weight:700">{_esc(row['result'])} {_pct(row['change_rate'])}</span></p>

  <h2 style="{_H2}">예측 요약</h2>
  {_headline_table(row)}

  <h2 style="{_H2}">방향 확률</h2>
  {_probability_table(row)}

  <h2 style="{_H2}">판단 근거</h2>
  <div style="font-size:13.5px;line-height:1.75;background:#f8f9fb;border:1px solid #e2e5ea;
       border-radius:8px;padding:14px 16px;margin-bottom:18px;white-space:pre-wrap">{_esc(row.get('detail'))}</div>

  <h2 style="{_H2}">당일 마감 해설</h2>
  <p style="font-size:13.5px;line-height:1.7;margin:0 0 4px">{_esc(row.get('close_summary') or '-')}</p>
  <p style="font-size:12.5px;color:#6b7280;margin:0 0 18px">
    기준일 종가 등락 {_pct(row.get('close_change_rate'))}</p>

  <h2 style="{_H2}">지표 항목별 근거</h2>
  {_evidence_table(row)}

  <h2 style="{_H2}">이 종목 예측 적중률</h2>
  {_accuracy_table(acc)}
  {_last_result_block(history)}

  <h2 style="{_H2}">신뢰도 판정 사유</h2>
  {notes_html or "<p style='color:#6b7280;font-size:12.5px'>특이사항 없음</p>"}

  <p style="margin:24px 0 0"><a href="{SITE_URL}/ai-prediction"
     style="color:#1f6fb2;font-size:13px">사이트에서 전체 예측 보기 &rarr;</a></p>
  <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #e2e5ea;
     font-size:11.5px;color:#9097a1;line-height:1.6">{_esc(prediction_engine.DISCLAIMER)}</p>
</div>"""


def build_subject(row: dict) -> str:
    d = cal.from_key(row["predict_date"])
    return (
        f"[{d.month}/{d.day} 예측] {row['name']} {row['result']} "
        f"{float(row['change_rate']):+.2f}% · 확신도 {row['confidence']} "
        f"(신뢰도 {row.get('reliability_grade') or '-'})"
    )


def build_text(row: dict) -> str:
    """Plain-text alternative. Some Naver clients render it instead of the HTML, and a
    mail that degrades to an empty body there is a mail that didn't arrive."""
    return "\n".join(
        [
            f"{row['name']} ({row['code']} · {row['market']})",
            f"{_date_label(row['predict_date'])} 예측",
            "",
            f"방향: {row['result']} {float(row['change_rate']):+.2f}%",
            f"기준 종가: {_price(row['base_price'], row['market'])}",
            f"예측 시세: {_price(row['predict_price'], row['market'])}",
            f"확신도: {row['confidence']} / 신뢰도: {row.get('reliability_grade')} ({row.get('reliability')}점)",
            f"확률: 상승 {row.get('prob_up')}% · 보합 {row.get('prob_flat')}% · 하락 {row.get('prob_down')}%",
            "",
            "[판단 근거]",
            (row.get("detail") or "").strip(),
            "",
            f"{SITE_URL}/ai-prediction",
            "",
            prediction_engine.DISCLAIMER,
        ]
    )


# ---------------------------------------------------------------------------
# sending
# ---------------------------------------------------------------------------

def _send_via_resend(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    """One POST, no mailbox credential involved.

    Errors are raised with Resend's own message attached: the two failures that
    actually happen here are an unverified sender domain and delivering to an address
    other than the Resend account's own, and both are only diagnosable from the body.
    """
    resp = requests.post(
        RESEND_ENDPOINT,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": f"{MAIL_FROM_NAME} <{RESEND_FROM}>",
            "to": [to_addr],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        detail = ""
        try:
            payload = resp.json()
            detail = payload.get("message") or payload.get("error") or resp.text
        except ValueError:
            detail = resp.text
        raise RuntimeError(f"Resend {resp.status_code}: {detail}{_resend_hint(detail)}"[:500])


def _resend_hint(detail: str) -> str:
    """Turns Resend's two first-run rejections into the action that fixes them.

    Both are configuration rather than code, both are worded from Resend's side of
    the problem, and both otherwise reach an operator as an English sentence in a log
    row with no indication of what to do about it.
    """
    lowered = (detail or "").lower()
    if "testing emails" in lowered or "own email" in lowered:
        return (
            " — 도메인 인증 전에는 Resend 가입에 사용한 주소로만 발송됩니다. "
            "구독 주소를 가입 주소와 맞추거나, Resend에서 발신 도메인을 인증하세요."
        )
    if "domain" in lowered and "verif" in lowered:
        return (
            " — 발신 도메인이 인증되지 않았습니다. PREDICTION_MAIL_FROM 을 비우면 "
            "인증 없이 쓸 수 있는 공용 발신자로 나갑니다."
        )
    if "api key" in lowered or "unauthorized" in lowered:
        return " — API 키가 올바르지 않습니다. PREDICTION_MAIL_RESEND_KEY 를 확인하세요."
    return ""


def _send_via_smtp(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header(MAIL_FROM_NAME, "utf-8")), MAIL_FROM))
    msg["To"] = to_addr
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    context = ssl.create_default_context()
    if USE_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=30) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(MAIL_FROM, [to_addr], msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
            s.ehlo()
            s.starttls(context=context)
            s.ehlo()
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(MAIL_FROM, [to_addr], msg.as_string())


def _send_one(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    """Dispatches to whichever transport is configured, API key first."""
    backend = backend_name()
    if backend == "resend":
        _send_via_resend(to_addr, subject, html_body, text_body)
    elif backend == "smtp":
        _send_via_smtp(to_addr, subject, html_body, text_body)
    else:
        raise MailNotConfigured("메일 발송 설정이 없습니다.")


def _pick_row(code: str, predict_date: str | None) -> dict | None:
    """The row for `predict_date`, or the newest one if that day has none.

    Falling back matters for the mixed watchlist: the KR and US batches land on
    different 예측일자 for most of the day, so a run asking for today's KRX date would
    otherwise silently drop every NASDAQ name on the list.
    """
    history = prediction_store.list_by_code(code, limit=30)
    if not history:
        return None
    if predict_date:
        exact = next((h for h in history if h["predict_date"] == predict_date), None)
        if exact:
            return exact
    return history[0]


def send_watchlist(
    codes: tuple[str, ...] = DEFAULT_WATCHLIST,
    predict_date: str | None = None,
    to_addr: str | None = None,
    dry_run: bool = False,
    manual: bool = False,
) -> dict:
    """One mail per code. Returns a per-stock report rather than raising on the first
    failure — a dead ticker on the list must not cost the other four their mail.

    `manual=False` is the scheduled batch and sends each stock at most once per Seoul
    calendar day; a stock already mailed today is reported as skipped rather than sent
    again. `manual=True` is an operator pressing the button in the admin panel and
    always sends — that is the whole point of the button, and someone who asks twice
    on purpose is not making the mistake the daily cap exists to prevent.
    """
    if not dry_run and not is_configured():
        raise MailNotConfigured(
            "PREDICTION_MAIL_RESEND_KEY 또는 "
            "PREDICTION_MAIL_USER / PREDICTION_MAIL_PASSWORD 가 설정되지 않았습니다."
        )

    to_addr = to_addr or MAIL_TO
    if not to_addr:
        raise MailNotConfigured("수신 주소(PREDICTION_MAIL_TO)가 설정되지 않았습니다.")
    accuracy = prediction_grader.accuracy_summary(tuple(codes))
    sent, skipped, failed = [], [], []

    for code in codes:
        row = _pick_row(code, predict_date)
        if row is None:
            skipped.append({"code": code, "reason": "예측 이력 없음"})
            continue

        # The daily cap, checked per stock rather than per run: a batch that retries
        # after a partial failure has to be able to finish the stocks it missed
        # without re-mailing the ones it already delivered.
        if not manual and not dry_run and mail_subscription_store.already_sent(to_addr, code):
            skipped.append({"code": code, "name": row["name"], "reason": "오늘 이미 발송됨"})
            continue

        history = prediction_store.list_by_code(code, limit=30)
        subject = build_subject(row)
        html_body = build_html(row, accuracy.get(code), history)
        text_body = build_text(row)

        if dry_run:
            sent.append(
                {
                    "code": code,
                    "name": row["name"],
                    "predict_date": row["predict_date"],
                    "subject": subject,
                    "html_bytes": len(html_body.encode("utf-8")),
                }
            )
            continue

        try:
            _send_one(to_addr, subject, html_body, text_body)
            sent.append({"code": code, "name": row["name"], "predict_date": row["predict_date"], "subject": subject})
            mail_subscription_store.record_send(
                to_addr, code, row["name"], row["predict_date"], subject, "sent", manual
            )
            logger.info("prediction_mail: sent %s -> %s", code, mask_address(to_addr))
        except Exception as exc:  # noqa: BLE001 - report and continue down the list
            logger.warning("prediction_mail: send failed for %s (%s)", code, exc)
            failed.append({"code": code, "error": str(exc)})
            mail_subscription_store.record_send(
                to_addr, code, row["name"], row["predict_date"], subject, "failed", manual, str(exc)
            )

    return {
        # Masked, always. This dict is printed by the CLI, returned over HTTP and
        # written to logs; the caller already knows who it configured, so there is no
        # reader of this field who needs the address in the clear.
        "to": mask_address(to_addr),
        "requested": list(codes),
        "predict_date": predict_date,
        "dry_run": dry_run,
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
        "ran_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


def send_subscriptions(
    predict_date: str | None = None,
    dry_run: bool = False,
    manual: bool = False,
    only_account: str | None = None,
) -> dict:
    """The batch entry point: every active subscription in the table gets its own
    stocks, and nothing else.

    Recipients and watchlists come from mail_subscription_store rather than from this
    module's constants, so adding a stock for one reader is a row and not a deploy. A
    failure for one address is reported and the next address still runs — the whole
    point of a per-subscriber batch is that subscribers are independent.
    """
    targets = mail_subscription_store.resolve_targets(active_only=True)
    if only_account:
        # Matched on account_id, never on the mask. Several distinct addresses can
        # share one mask, so matching on that made a per-account send button mean
        # "send to every account that happens to mask the same way" — which with one
        # subscriber was invisible and with two would have been a privacy incident.
        # The id keeps the clear address inside this process just as the mask did,
        # while actually identifying one account.
        wanted = only_account.strip().lower()
        targets = {
            addr: codes
            for addr, codes in targets.items()
            if mail_subscription_store.account_id(addr) == wanted or addr == wanted
        }
        if not targets:
            return {
                "subscriptions": 0,
                "results": [],
                "note": "지정한 계정을 찾을 수 없습니다.",
                "ran_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            }
    if not targets:
        return {
            "subscriptions": 0,
            "results": [],
            "note": "활성 구독이 없습니다. mail_subscription_store.subscribe() 로 등록하세요.",
            "ran_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }

    results = []
    for addr, codes in targets.items():
        try:
            results.append(
                send_watchlist(
                    codes=tuple(codes),
                    predict_date=predict_date,
                    to_addr=addr,
                    dry_run=dry_run,
                    manual=manual,
                )
            )
        except Exception as exc:  # noqa: BLE001 - one bad subscriber must not stop the rest
            logger.warning(
                "prediction_mail: subscription run failed for %s (%s)", mask_address(addr), exc
            )
            results.append({"to": mask_address(addr), "error": str(exc), "sent": [], "failed": []})

    return {
        "subscriptions": len(targets),
        "results": results,
        "dry_run": dry_run,
        "predict_date": predict_date,
        "ran_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
