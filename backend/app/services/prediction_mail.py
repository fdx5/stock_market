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
import threading
import time
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

import requests

from app.services import (
    mail_config_store,
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
#
# Every one of these settings is read through mail_config_store at the moment it is
# used, not bound to a module constant at import. Two reasons, both learned the hard
# way: a constant captures whatever the environment held when the process started, so
# a value added to a running service reads as missing until someone restarts it (the
# `needs_restart` flag below exists only to make that visible) — and the settings now
# live in a table an operator can edit from the admin panel, which would be pointless
# if the process only looked once. See mail_config_store for the precedence rule.
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


def resend_api_key(to_addr: str | None = None) -> str | None:
    """The key to send *this* recipient with.

    A recipient's own key wins over the shared one. Without a verified sending domain
    a Resend key reaches only the address its account was registered with, so one
    shared key cannot serve two subscribers — installing the second subscriber's key
    globally doesn't add them, it swaps which one is refused. Each recipient carrying
    their own key is the arrangement that reaches everyone, because each is then the
    account owner the restriction is written for.

    Called with no address (`backend_name`, the CLI's configured-check) it reports the
    shared key alone, which is the right answer for "can this service send at all".
    """
    return mail_config_store.account_key(to_addr) or mail_config_store.get(
        "PREDICTION_MAIL_RESEND_KEY"
    )


def resend_from() -> str:
    return mail_config_store.get("PREDICTION_MAIL_FROM") or RESEND_DEFAULT_FROM


def smtp_host() -> str:
    return mail_config_store.get("PREDICTION_MAIL_SMTP_HOST") or "smtp.naver.com"


def smtp_port() -> int:
    raw = mail_config_store.get("PREDICTION_MAIL_SMTP_PORT") or "587"
    try:
        return int(raw)
    except ValueError:
        # A typo'd port is a misconfiguration, not a reason to crash every caller that
        # merely asks whether mail is set up — `smtp_configured()` reads this too.
        logger.warning("prediction_mail: SMTP 포트 값이 숫자가 아닙니다 (%r), 587 사용", raw)
        return 587


def smtp_user() -> str | None:
    return mail_config_store.get("PREDICTION_MAIL_USER")


def smtp_password() -> str | None:
    return mail_config_store.get("PREDICTION_MAIL_PASSWORD")


def mail_from() -> str | None:
    """Most providers reject a From that isn't the authenticated mailbox, so this
    defaults to the SMTP login rather than to a friendly-looking address that would
    silently bounce."""
    return mail_config_store.get("PREDICTION_MAIL_FROM") or smtp_user()


def mail_from_name() -> str:
    return mail_config_store.get("PREDICTION_MAIL_FROM_NAME") or "K-Stock Hub 예측"


def mail_to() -> str | None:
    """The one-off recipient for `--to`-style sends, and the only setting still read
    from the environment alone: it is not a transport setting but a fallback address
    from before the subscription table existed. Real recipients are rows now.

    No default. A personal address is not configuration to be baked into a public
    repository, and with nothing set the batch says so rather than mailing a stale
    hard-coded address.
    """
    return os.environ.get("PREDICTION_MAIL_TO")


def use_ssl() -> bool:
    """465 is implicit TLS (SMTPS); 587 is STARTTLS. Choosing on the port rather than
    on a second flag keeps one setting instead of two that can contradict each other."""
    return smtp_port() == 465

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


class ResendRecipientRestricted(RuntimeError):
    """Resend refused *this recipient*, not the message.

    Its own class because it is the one Resend failure that another transport can
    still deliver: with an unverified sender domain the shared sender only reaches the
    address the Resend account was registered with, so every other subscriber is
    rejected no matter how correct the mail is. Every other Resend error (bad key,
    malformed body) would fail identically over SMTP and must stay a plain failure —
    retrying those would just send the same rejection down a second path.
    """


def smtp_configured() -> bool:
    return bool(smtp_user() and smtp_password() and mail_from())


def backend_name() -> str | None:
    """Which transport will actually be used, or None if neither is configured.

    Reported to the admin panel so an operator can see *how* mail is going out, not
    just that it can — the two have very different failure modes and the panel is the
    only place that distinction is visible.
    """
    if resend_api_key():
        return "resend"
    if smtp_configured():
        return "smtp"
    return None


def is_configured() -> bool:
    """Can this service send to anyone at all?

    Per-account keys count. With every subscriber carrying their own Resend key and no
    shared key configured, `backend_name()` is None and yet every send would succeed —
    gating the admin panel's 수기 발송 button on that alone locked out exactly the
    setup the per-account table exists to support.
    """
    return backend_name() is not None or bool(mail_config_store.account_keys_masked())


def config_diagnosis() -> dict:
    """Which mail settings this process can actually see, and where each came from.

    "발송 설정 필요" on the panel is the same message whether a key was never set, was
    set on the wrong service, or was spelled differently, and those need completely
    different fixes. Reading the configuration back is the only thing that separates
    them: the deploy log says what was configured, this says what arrived.

    `settings` carries the source of each value ('db' or 'env'), which is the question
    that matters once a setting can come from two places — a row overriding a corrected
    environment variable looks exactly like a corrected environment variable that
    didn't take, and only the source tells them apart. Secrets arrive masked; see
    mail_config_store.describe.
    """
    settings = mail_config_store.describe()
    live = {s["name"]: s["configured"] for s in settings}
    # Names people reach for when the real one doesn't work — reported so a typo or a
    # provider's own documented name shows up as "set, but not under the name this
    # app reads" instead of as nothing at all.
    near_misses = [
        name
        for name in ("RESEND_API_KEY", "RESEND_KEY", "MAIL_RESEND_KEY", "PREDICTION_MAIL_RESEND_API_KEY")
        if os.environ.get(name)
    ]
    return {
        "present": live,
        "settings": settings,
        "unrecognized_names": near_misses,
        # Kept in the payload for the panel's sake, permanently False now: nothing here
        # is bound at import any more, so a value that has landed anywhere this process
        # can read is a value it is already using. Removing the field outright would
        # break a deployed frontend that still reads it.
        "needs_restart": False,
    }


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
            "Authorization": f"Bearer {resend_api_key(to_addr)}",
            "Content-Type": "application/json",
        },
        json={
            "from": f"{mail_from_name()} <{resend_from()}>",
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
        message = f"Resend {resp.status_code}: {detail}{_resend_hint(detail)}"[:500]
        if _is_recipient_restriction(detail):
            raise ResendRecipientRestricted(message)
        raise RuntimeError(message)


def _is_recipient_restriction(detail: str) -> bool:
    """Does this rejection mean "not this address" rather than "not this message"?

    Matched on Resend's wording because the status code doesn't distinguish it — the
    restriction and a malformed payload are both 403/422. The same phrases drive
    `_resend_hint`; they are read here to decide whether SMTP is worth trying.
    """
    lowered = (detail or "").lower()
    return "testing emails" in lowered or "own email" in lowered


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
            " — 발신 도메인이 인증되지 않았습니다. 관리자 패널의 발신 주소"
            "(PREDICTION_MAIL_FROM)를 비우면 인증 없이 쓸 수 있는 공용 발신자로 나갑니다."
        )
    if "api key" in lowered or "unauthorized" in lowered:
        return (
            " — API 키가 올바르지 않습니다. 관리자 패널의 메일 설정에서 "
            "PREDICTION_MAIL_RESEND_KEY 를 다시 저장하세요."
        )
    return ""


def _send_via_smtp(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = Header(subject, "utf-8")
    sender = mail_from()
    msg["From"] = formataddr((str(Header(mail_from_name(), "utf-8")), sender))
    msg["To"] = to_addr
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    host, port = smtp_host(), smtp_port()
    user, password = smtp_user(), smtp_password()
    context = ssl.create_default_context()
    if use_ssl():
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as s:
            s.login(user, password)
            s.sendmail(sender, [to_addr], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.ehlo()
            s.starttls(context=context)
            s.ehlo()
            s.login(user, password)
            s.sendmail(sender, [to_addr], msg.as_string())


def _send_one(to_addr: str, subject: str, html_body: str, text_body: str) -> None:
    """Dispatches to whichever transport is configured, API key first.

    With both configured, a Resend recipient restriction falls through to SMTP rather
    than failing. That case is specific and worth handling: an unverified Resend sender
    domain delivers only to the Resend account's own address, so the first subscriber
    receives mail normally and every subsequent one is rejected — the transport works,
    just not for them. SMTP authenticates as a real mailbox and has no such limit, so
    it delivers what Resend won't. Only this error falls through; see
    ResendRecipientRestricted.
    """
    # Resolved per recipient: a subscriber with their own key sends via the API even
    # when no shared key exists, which is the whole point of the per-account table.
    backend = "resend" if resend_api_key(to_addr) else ("smtp" if smtp_configured() else None)
    if backend == "resend":
        try:
            _send_via_resend(to_addr, subject, html_body, text_body)
        except ResendRecipientRestricted:
            if not smtp_configured():
                raise
            logger.info(
                "prediction_mail: Resend refused %s (unverified sender domain), sending via SMTP",
                mask_address(to_addr),
            )
            _send_via_smtp(to_addr, subject, html_body, text_body)
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
    to_addr = to_addr or mail_to()
    if not to_addr:
        raise MailNotConfigured("수신 주소(PREDICTION_MAIL_TO)가 설정되지 않았습니다.")

    # Resolved after the recipient is known, and against that recipient. A subscriber
    # holding their own Resend key is sendable even with no shared key configured at
    # all — checking `is_configured()` here (which only sees the shared settings)
    # refused exactly the case the per-account table exists to serve.
    if not dry_run and not (resend_api_key(to_addr) or smtp_configured()):
        raise MailNotConfigured(
            f"{mask_address(to_addr)} 로 보낼 수단이 없습니다 — 이 계정의 Resend 키를 "
            "등록하거나, 공용 PREDICTION_MAIL_RESEND_KEY 또는 "
            "PREDICTION_MAIL_USER / PREDICTION_MAIL_PASSWORD 를 설정하세요."
        )
    accuracy = prediction_grader.accuracy_summary(tuple(codes))
    sent, skipped, failed = [], [], []

    for code in codes:
        row = _pick_row(code, predict_date)
        if row is None:
            skipped.append({"code": code, "reason": "예측 이력 없음"})
            continue

        # The cap, checked per stock rather than per run: a batch that retries after a
        # partial failure has to be able to finish the stocks it missed without
        # re-mailing the ones it already delivered.
        #
        # Keyed on 예측일자 when the row has one, which is every real row — a forecast
        # is the thing a reader should receive once, and that is not the same as once a
        # calendar day. Two runs can produce one forecast (cron and the in-process
        # scheduler on the same evening) and one forecast can outlive a day (the forced
        # Sunday run re-scores Friday's session), so the day rule admits duplicates the
        # 예측일자 rule catches. It falls back to the day rule only if a row somehow
        # carries no predict_date, where some cap is better than none.
        if not manual and not dry_run:
            if row["predict_date"]:
                seen = mail_subscription_store.already_sent_for_prediction(
                    to_addr, code, row["predict_date"]
                )
                reason = "이미 발송된 예측"
            else:
                seen = mail_subscription_store.already_sent(to_addr, code)
                reason = "오늘 이미 발송됨"
            if seen:
                skipped.append({"code": code, "name": row["name"], "reason": reason})
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
    only_codes: tuple[str, ...] | None = None,
) -> dict:
    """The batch entry point: every active subscription in the table gets its own
    stocks, and nothing else.

    Recipients and watchlists come from mail_subscription_store rather than from this
    module's constants, so adding a stock for one reader is a row and not a deploy. A
    failure for one address is reported and the next address still runs — the whole
    point of a per-subscriber batch is that subscribers are independent.

    `only_codes` narrows every subscriber's list to an intersection, which is what the
    automatic post-batch send uses to stay inside the region that just ran. Without it
    the KR batch would mail a subscriber's NASDAQ names too, carrying yesterday's
    figures and — worse — consuming their 예측일자 slot, so the US batch thirteen hours
    later would find them already sent and skip the mail that had the fresh data. An
    address left with no codes after the intersection is dropped rather than mailed an
    empty report.
    """
    targets = mail_subscription_store.resolve_targets(active_only=True)
    if only_codes is not None:
        wanted_codes = set(only_codes)
        targets = {
            addr: [c for c in codes if c in wanted_codes]
            for addr, codes in targets.items()
        }
        targets = {addr: codes for addr, codes in targets.items() if codes}
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
        # Two very different situations, and the automatic send hits the second one
        # routinely: a region whose stocks nobody subscribes to is a normal quiet run,
        # not a misconfigured table with no subscribers in it.
        return {
            "subscriptions": 0,
            "results": [],
            "note": (
                "이번 발송 대상 종목을 구독한 계정이 없습니다."
                if only_codes is not None
                else "활성 구독이 없습니다. mail_subscription_store.subscribe() 로 등록하세요."
            ),
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


# ---------------------------------------------------------------------------
# automatic send, 10 minutes after a batch produces the rows
# ---------------------------------------------------------------------------
#
# There is no clock time for this. The mail follows the data: whenever a region's
# predictions land, that region's subscribers hear about it ten minutes later. Which
# means the two regions mail at different times of day by construction rather than by
# configuration — the KR batch runs 23:00 KST and the US batch 23:00 ET, about
# thirteen hours apart, so a subscriber holding both gets a late-evening mail for their
# Korean names and a midday one for their US names. Pinning a single clock time
# instead would have mailed one of the two regions a forecast that didn't exist yet.
#
# The ten minutes are the same headroom kakao_notify uses after the same event: the
# rows are committed before run_batch returns, so the delay is not waiting for data to
# be ready but for the admin panel's view of the run to settle, and it leaves a window
# in which an operator who sees a bad run can still pull the plug.

_AUTO_SEND_DELAY_SECONDS = 10 * 60


def _delayed_subscription_send(codes: tuple[str, ...], predict_date: str | None) -> None:
    time.sleep(_AUTO_SEND_DELAY_SECONDS)
    try:
        report = send_subscriptions(
            predict_date=predict_date,
            # Not manual: this is the scheduled sender the 예측일자 cap was written
            # for, and the thing that stops two triggers landing on one evening from
            # sending two copies of one forecast.
            manual=False,
            only_codes=codes,
        )
        sent = sum(len(r.get("sent") or []) for r in report.get("results", []))
        logger.info(
            "prediction_mail: auto send after batch — %d accounts, %d mails, predict_date=%s",
            report.get("subscriptions", 0),
            sent,
            predict_date,
        )
    except Exception:  # noqa: BLE001
        # Same tolerance as kakao_notify's delayed send: there is no retry queue for a
        # one-off, and the next batch will produce the next forecast regardless. The
        # attempt is already in mail_send_log for anyone asking why nothing arrived.
        logger.exception("prediction_mail: auto send after batch failed")


def schedule_after_batch(summary: dict) -> None:
    """Queues the automatic send for the stocks a batch run just produced.

    Called from prediction_batch.run_batch on a successful run. The code list comes
    from that run's own rows rather than from the region name, so the mail can only
    ever cover stocks whose predictions actually exist — a stock dropped from the
    roster, or one whose collection failed, simply isn't in the list.

    Silent no-op when mail is unconfigured or the run saved nothing, so an installation
    that never set up mail pays nothing for this and a skipped run doesn't spawn a
    thread that will find nothing to do.

    A daemon thread rather than a persistent queue: a restart inside the ten minutes
    loses the send, the same volatility already accepted for kakao_notify's delayed
    notification and prediction_batch's own in-memory run history. The next run's mail
    is unaffected, and nothing is sent twice as a result.
    """
    if not is_configured():
        return
    codes = tuple(dict.fromkeys(r["code"] for r in summary.get("results") or []))
    if not codes:
        return
    threading.Thread(
        target=_delayed_subscription_send,
        args=(codes, summary.get("predict_date")),
        daemon=True,
    ).start()
