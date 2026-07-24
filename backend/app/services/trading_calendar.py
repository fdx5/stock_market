"""Trading-day arithmetic for the prediction batch.

The batch's whole output is keyed on "which day is this a prediction *for*", so
answering that has to be exact: a Friday-evening KRX run predicts Monday, and a run
on the eve of 설 연휴 predicts the day the market reopens, not tomorrow. Neither is
derivable from price history (the target day hasn't traded yet), so the holidays are
a maintained table.

Both markets close on their own holidays *and* on weekends, and the weekend rule is
handled separately from the table — so a holiday that already falls on a Saturday
doesn't need an entry to be skipped correctly.
"""

import datetime as dt
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
# US market hours follow US DST, so this must be the named zone rather than a fixed
# offset — the New York close is 06:00 KST in summer and 07:00 KST in winter, and the
# batch's schedule and its "which session just ended" reasoning both depend on it.
ET = ZoneInfo("America/New_York")

DATE_FORMAT = "%Y%m%d"

# KRX closures (Korean public holidays plus the exchange's own year-end closing day).
# Maintained by hand and extended each year — an expired table doesn't fail loudly, it
# just predicts a day the market is shut, so `has_calendar_for` below exists to let
# callers notice before that happens.
KRX_HOLIDAYS = {
    # 2026
    "20260101",  # 신정
    "20260216", "20260217", "20260218",  # 설날 연휴
    "20260302",  # 삼일절 대체공휴일
    "20260501",  # 근로자의 날 (증시 휴장)
    "20260505",  # 어린이날
    "20260525",  # 부처님오신날 대체공휴일
    "20260603",  # 제9회 전국동시지방선거
    "20260817",  # 광복절 대체공휴일
    "20260924", "20260925",  # 추석 연휴
    "20261005",  # 개천절 대체공휴일
    "20261009",  # 한글날
    "20261225",  # 성탄절
    "20261231",  # 연말 휴장일
    # 2027
    "20270101",
    "20270208", "20270209",  # 설날 연휴 (대체공휴일 포함)
    "20270301",
    "20270505",
    "20270513",  # 부처님오신날
    "20270607",  # 현충일 대체공휴일
    "20270816",  # 광복절 대체공휴일
    "20270914", "20270915", "20270916",  # 추석 연휴
    "20271004",  # 개천절 대체공휴일
    "20271011",  # 한글날 대체공휴일
    "20271231",
}

# NYSE/Nasdaq full closures. Half-days (the 13:00 ET closes the day after Thanksgiving
# and on Christmas Eve) are deliberately absent: the market does trade and does print a
# close, which is all this batch needs — treating them as holidays would skip a real
# session.
US_HOLIDAYS = {
    # 2026
    "20260101",  # New Year's Day
    "20260119",  # MLK Jr. Day
    "20260216",  # Presidents' Day
    "20260403",  # Good Friday
    "20260525",  # Memorial Day
    "20260619",  # Juneteenth
    "20260703",  # Independence Day (observed)
    "20260907",  # Labor Day
    "20261126",  # Thanksgiving
    "20261225",  # Christmas
    # 2027
    "20270101",
    "20270118",
    "20270215",
    "20270326",
    "20270531",
    "20270618",  # Juneteenth (observed)
    "20270705",  # Independence Day (observed)
    "20270906",
    "20271125",
    "20271224",  # Christmas (observed)
}

_HOLIDAYS = {"KR": KRX_HOLIDAYS, "US": US_HOLIDAYS}

KOREAN_WEEKDAYS = ("월", "화", "수", "목", "금", "토", "일")


def _holiday_set(region: str) -> set[str]:
    return _HOLIDAYS.get(region, set())


def is_trading_day(date: dt.date, region: str) -> bool:
    if date.weekday() >= 5:
        return False
    return date.strftime(DATE_FORMAT) not in _holiday_set(region)


def next_trading_day(date: dt.date, region: str) -> dt.date:
    """The first session strictly after `date`. Bounded at 30 days so a mistake in the
    holiday table (or a genuinely unprecedented closure) surfaces as an exception
    rather than an infinite loop inside a batch run."""
    candidate = date + dt.timedelta(days=1)
    for _ in range(30):
        if is_trading_day(candidate, region):
            return candidate
        candidate += dt.timedelta(days=1)
    raise ValueError(f"No trading day found within 30 days after {date} for region={region}")


def has_calendar_for(date: dt.date, region: str) -> bool:
    """Whether the holiday table still covers `date`'s year. The batch logs a warning
    when this goes false so an unmaintained table is noticed while it is merely
    incomplete, instead of after it has silently published a prediction for a day the
    exchange was closed."""
    years = {key[:4] for key in _holiday_set(region)}
    return str(date.year) in years


def now_kst() -> dt.datetime:
    return dt.datetime.now(KST)


def now_et() -> dt.datetime:
    return dt.datetime.now(ET)


# Each market's closing bell in its own local time. The batch reports on completed
# sessions only, so this is the boundary at which "today" becomes a session that can be
# reported on at all.
CLOSE_TIME = {"KR": dt.time(15, 30), "US": dt.time(16, 0)}


def session_date(region: str) -> dt.date:
    """The trading day the batch is reporting on — i.e. the most recent session that
    has actually closed.

    Anchored to each market's *own* local date, which is the only reading that
    survives the timezone gap: the New York close lands after midnight KST, so a US
    batch triggered at 16:10 ET is still working on the ET calendar day, while the
    server (and the cron runner) may already be on the next UTC/KST day.

    If the batch is triggered on a non-trading day — a manual re-run over a weekend,
    a cron firing on a holiday — this walks *back* to the most recent completed
    session rather than inventing data for a day that never traded.

    The same walk-back applies when today *is* a trading day whose bell hasn't rung
    yet. Only the in-process scheduler is time-gated; the cron endpoint and the admin
    re-run button call run_batch directly at whatever moment they fire. Without this
    check a manual US run at 05:30 ET labelled 7월 23일's close as 수집일자 7월 24일 and
    predicted the following Monday — skipping the 7월 24일 session entirely and
    attributing Thursday's prices to Friday. A session is only reportable once it is
    over.
    """
    now = now_kst() if region == "KR" else now_et()
    today = now.date()
    if is_trading_day(today, region) and now.time() < CLOSE_TIME.get(region, dt.time(0, 0)):
        today -= dt.timedelta(days=1)
    for _ in range(30):
        if is_trading_day(today, region):
            return today
        today -= dt.timedelta(days=1)
    raise ValueError(f"No recent trading day found for region={region}")


def to_key(date: dt.date) -> str:
    return date.strftime(DATE_FORMAT)


def from_key(key: str) -> dt.date:
    return dt.datetime.strptime(key, DATE_FORMAT).date()


def korean_weekday(date: dt.date) -> str:
    return KOREAN_WEEKDAYS[date.weekday()]
