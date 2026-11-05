"""Read-only source negotiation, pagination and ETF routing; no DB or app lifespan."""
import json
from unittest.mock import Mock

import pytest
import requests

from app.data import toss_session as toss, toss_discussion_fetcher as fetcher
from app.services import public_discussion as public
from app.services.cache import TTLCache


def response(status=200, result=None, error=None):
    r = requests.Response()
    r.status_code = status
    r.url = toss.INFO_API + "/test"
    r._content = json.dumps({"result": result or {}, "error": error}).encode()
    r._content_consumed = True
    return r


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(toss, "session", requests.Session())
    monkeypatch.setattr(toss, "_public_generation", 0)
    monkeypatch.setattr(toss, "_gate", toss._RequestGate())
    monkeypatch.setattr(toss, "cache", TTLCache())
    monkeypatch.setattr(fetcher, "cache", TTLCache())
    monkeypatch.setattr(public.naver, "resolve_naver_suffix", lambda _: "O")


def test_public_client_initialization_is_bounded_and_memory_only(monkeypatch):
    calls = []
    sequence = iter([response(400, error={"code":"invalid-client-state"}), response(), response(result={"results":[]})])
    def request(method, url, **kw):
        calls.append((method,url))
        return next(sequence)
    monkeypatch.setattr(toss.session,"request",request)
    assert toss.request_json("GET","/api/v4/comments",host="cert",list_field="results")["result"] == {"results":[]}
    assert calls == [("GET",toss.CERT_API+"/api/v4/comments"),("GET",toss.PUBLIC_API+"/api/v3/init"),("GET",toss.CERT_API+"/api/v4/comments")]
    assert toss._public_generation == 1
    assert any(c.name == "deviceId" for c in toss.session.cookies)
    toss._init_public_session(0)
    assert len(calls) == 3


def test_forbidden_response_does_not_trigger_anonymous_initialization(monkeypatch):
    request=Mock(return_value=response(403))
    monkeypatch.setattr(toss.session,"request",request)
    with pytest.raises(requests.HTTPError): toss.request_json("GET","/denied")
    assert request.call_count == 1


def test_exact_etf_listing_is_resolved_from_public_stock_info(monkeypatch):
    request=Mock(return_value={"result":{"symbol":"QQQI","code":"NAS0240130003","companyCode":"issuer"}})
    monkeypatch.setattr(toss,"request_json",request)
    assert toss._resolve_codes("QQQI") == {"product_code":"NAS0240130003","company_code":"issuer"}
    assert request.call_args.args == ("GET","/api/v2/stock-infos/code-or-symbol/QQQI")
    request.return_value={"result":{"symbol":"QQQM","code":"other"}}
    assert toss._resolve_codes("QQQ")["product_code"] is None


def comment(i, body=True):
    return {"commentId":str(i),"createdAt":"2026-11-05T09:00:00+09:00","message":{"message":f"body {i}" if body else ""}}


def test_lookahead_is_not_skipped_between_ten_post_pages(monkeypatch):
    monkeypatch.setattr(fetcher,"resolve_product_code",lambda *a,**k:"listing")
    calls=[]
    def request(*a,**kw):
        assert kw['host']=='cert'
        cursor=int(kw['params'].get('lastCommentId',100))
        calls.append(cursor)
        rows=[comment(i) for i in range(cursor-1,cursor-12,-1)]
        return {"result":{"results":rows,"hasNext":True,"key":rows[-1]['commentId']}}
    monkeypatch.setattr(fetcher,"request_json",request)
    first=fetcher._fetch_discussion("QQQ",10,None)
    second=fetcher._fetch_discussion("QQQ",10,first['next_offset'])
    assert [p['id'] for p in first['items']+second['items']] == [str(i) for i in range(99,79,-1)]
    assert calls == [100,90]


def test_hidden_shells_are_skipped_and_page_is_filled(monkeypatch):
    monkeypatch.setattr(fetcher,"resolve_product_code",lambda *a,**k:"listing")
    pages=iter([{"results":[comment(i,body=i>5) for i in range(1,12)],"hasNext":True,"key":11},
                {"results":[comment(i) for i in range(12,23)],"hasNext":True,"key":22}])
    monkeypatch.setattr(fetcher,"request_json",lambda *a,**k:{"result":next(pages)})
    data=fetcher._fetch_discussion("QQQ",10,None)
    assert [p['id'] for p in data['items']] == [str(i) for i in range(6,16)]
    assert data['next_offset']=='15'


def test_end_of_board_has_no_fake_next_page(monkeypatch):
    monkeypatch.setattr(fetcher,"resolve_product_code",lambda *a,**k:"listing")
    monkeypatch.setattr(fetcher,"request_json",lambda *a,**k:{"result":{"results":[comment(1)],"hasNext":False}})
    data=fetcher._fetch_discussion("QQQ",10,None)
    assert len(data['items'])==1 and data['next_offset'] is None


def test_etf_fallback_uses_etf_board_and_keeps_its_cursor(monkeypatch):
    monkeypatch.setattr(public,"resolve_product_code",lambda *a,**k:None)
    source=Mock(return_value={"items":[{"id":"n1"}],"next_offset":"-123"})
    monkeypatch.setattr(public.naver,"get_discussion",source)
    first=public.get_public_discussion("QQQ",10,None,"foreignEtf")
    assert first['source']=='naver' and first['next_offset']=='n:-123'
    assert source.call_args.args[3]=='foreignEtf'
    # Even after Toss recovers, a Naver page never switches board mid-read.
    resolver=Mock(side_effect=AssertionError("must keep the source"))
    monkeypatch.setattr(public,"resolve_product_code",resolver)
    public.get_public_discussion("QQQ",10,first['next_offset'],"foreignEtf")
    assert source.call_args.args[2]=='-123'
    resolver.assert_not_called()


def test_toss_page_failure_does_not_switch_cursor_to_naver(monkeypatch):
    monkeypatch.setattr(public,"resolve_product_code",lambda *a,**k:"listing")
    monkeypatch.setattr(public,"get_toss_discussion",Mock(side_effect=requests.ReadTimeout()))
    fallback=Mock();monkeypatch.setattr(public.naver,"get_discussion",fallback)
    with pytest.raises(requests.ReadTimeout):public.get_public_discussion("QQQ",10,"t:123","foreignEtf")
    fallback.assert_not_called()


def test_real_empty_board_is_not_replaced_with_other_posts(monkeypatch):
    monkeypatch.setattr(public,"resolve_product_code",lambda *a,**k:"listing")
    monkeypatch.setattr(public,"get_toss_discussion",lambda *a,**k:{"items":[],"next_offset":None})
    fallback=Mock();monkeypatch.setattr(public.naver,"get_discussion",fallback)
    result=public.get_public_discussion("QQQ",10,None,"foreignEtf")
    assert result['source']=='toss' and result['items']==[]
    fallback.assert_not_called()
