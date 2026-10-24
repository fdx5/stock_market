"""Pure parsers and fresh temporary append-only files. No app.main or saved DB."""
import datetime as dt
import json
from pathlib import Path
from app.services import discovery_sources as sources


def test_dividend_amount_keeps_source_currency_without_fx_conversion(monkeypatch):
    monkeypatch.setattr(sources.cache, 'get_or_set', lambda key, ttl, fetch: fetch())
    monkeypatch.setattr(sources, 'yahoo_chart', lambda *args: {
        'meta': {'currency': 'KRW', 'exchangeTimezoneName': 'Asia/Seoul'},
        'events': {'dividends': {'one': {'date': 1790000000, 'amount': 183}}},
    })
    result = sources.asset('069500', 'kospi')
    assert result['currency'] == 'KRW'
    assert result['dividends'][0]['amount'] == 183
    assert result['dividends'][0]['currency'] == 'KRW'


def test_curve_keeps_missing_yields_missing():
    rows = sources.parse_curve('<feed xmlns:d="urn:data"><properties><d:NEW_DATE>2026-10-23T00:00:00</d:NEW_DATE><d:BC_2YEAR>3.5</d:BC_2YEAR><d:BC_10YEAR /></properties></feed>')
    assert rows == [{"date": "2026-10-23", "values": {"2YEAR": 3.5, "10YEAR": None}}]


def test_ics_timezone_dst_and_all_day_remain_distinct():
    text = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:GDP\nDTSTART;TZID=America/New_York:20261125T083000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Day\nDTSTART;VALUE=DATE:20261126\nEND:VEVENT\nEND:VCALENDAR'
    rows = sources.parse_ics(text)
    assert rows[0]['at'].startswith('2026-11-25T13:30:00')
    assert rows[1]['at'] is None


def test_symbol_whitelist_aliases_and_numbers():
    assert sources.symbol('USDKRW','nasdaq') == 'KRW=X'
    assert sources.symbol('005930','kospi') == '005930.KS'
    assert sources.number('1,234.5%') == 1234.5
    assert sources.number('NaN') is None
    assert sources.number(None) is None


def test_snapshot_only_appends_and_preserves_existing_record(tmp_path, monkeypatch):
    path = tmp_path / 'new-public-test.jsonl'
    original = '{"id":"first","market":"kospi","items":[{"code":"old"}]}\n'
    path.write_text(original,encoding='utf-8')
    monkeypatch.setattr(sources,'ARCHIVE',path)
    monkeypatch.setenv('DISCOVERY_PREVIEW_MODE','1')
    monkeypatch.setattr(sources,'read',lambda *a,**kw:{'generated_at':'2026-10-25','items':[{'code':'005930','name':'test','close':1}]})
    monkeypatch.setattr(sources,'_last_snapshot',{})
    result=sources.append_snapshot('kospi')
    assert result['recorded']
    assert path.read_text(encoding='utf-8').startswith(original)
    assert len(sources.snapshots('kospi')['items'])==2
    assert not sources.append_snapshot('kospi')['recorded']


def test_sessions_apply_dst_half_days_and_unknown_calendar():
    result=sources.sessions('2026-11-25')['items']
    half=next(r for r in result if r['date']=='2026-11-27' and r['region']=='US')
    assert half['half_day'] and half['end'].startswith('2026-11-27T18:00:00')
    assert all(not r['calendar_valid'] for r in sources.sessions('2029-01-01')['items'])
