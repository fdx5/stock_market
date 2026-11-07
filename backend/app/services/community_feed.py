"""Public discussion reader. No database, member profiles or persistent post storage.

Collection is demand-driven; entry refreshes coalesce for five seconds. Process-local
snapshots keep paging stable; a restart expires snapshots, never stored data.
"""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone, timedelta
from collections import OrderedDict
from threading import Lock
from urllib.parse import urlencode, urlparse, parse_qs, urljoin, urlunparse
from urllib.robotparser import RobotFileParser
import re
import time
import uuid
import unicodedata
from html import unescape
import logging
import json
from itertools import islice

import requests
from bs4 import BeautifulSoup, NavigableString, Tag, Comment

KST = timezone(timedelta(hours=9))
UA = "KospimapCommunity/1.0 (public discussion index; no AI training)"
SOURCES = {
    "kr": [("pp-stock", "뽐뿌 · 증권포럼", "pp", "stock"), ("da-stock", "다모앙 · 주식한당", "da", "stock"), ("cl-stock", "클리앙 · 주식한당", "cl", "cm_stock")],
    "global": [("pp-stock", "뽐뿌 · 증권포럼", "pp", "stock"), ("da-stock", "다모앙 · 주식한당", "da", "stock"), ("cl-stock", "클리앙 · 주식한당", "cl", "cm_stock")],
    "property": [("pp-house", "뽐뿌 · 부동산포럼", "pp", "house"), ("82-property", "82쿡 · 부동산 이야기", "82", "부동산"), ("82-apartment", "82쿡 · 아파트 이야기", "82", "아파트")],
}
# Additional independent public communities. All queries/boards are code-owned.
for _board in ('kr', 'global'):
    SOURCES[_board] += [
        ('tq-stock', '더쿠 · 주식방', 'tq', 'stock'),
        ('dog-stock', '개드립 · 주식·재테크', 'dog', 'stock'),
        ('pax-market', '팍스넷 · 거래소시황', 'pax', 'N00801'),
        ('bb-strange', '보배드림 · 경제 이야기', 'bb', 'strange'),
        ('da-free', '다모앙 · 경제 이야기', 'da', 'free'),
        ('82-stock', '82쿡 · 주식 이야기', '82', '주식'),
    ]
SOURCES['property'] += [
    ('tq-property', '더쿠 · 부동산 이야기', 'tq', 'square'),
    ('tq-housing', '더쿠 · 주거 이야기', 'tq', 'review'),
    ('dog-property', '개드립 · 주거·재테크', 'dog', 'stock'),
    ('bb-property', '보배드림 · 부동산 이야기', 'bb', 'strange'),
    ('bb-housing', '보배드림 · 주거 이야기', 'bb', 'freeb'),
    ('da-property', '다모앙 · 부동산 이야기', 'da', 'free'),
    ('82-lease', '82쿡 · 전월세 이야기', '82', '전세'),
    ('82-housing', '82쿡 · 주택 이야기', '82', '집값'),
]
SOURCES['global'].append(('toss-stocks','토스증권 · 해외 종목 토론','toss','global'))
for _board in SOURCES:
    SOURCES[_board].append(('rw-finance','루리웹 · 경제·주거 이야기','rw','300143'))
TOSS_SYMBOLS = ('NVDA','TSLA','IREN','PLTR','RKLB','SOFI','TQQQ','SOXL')
DC_GALLERIES = {"kospi": "mgallery/board", "stockus": "mgallery/board", "immovables": "board"}
_locks = {key: Lock() for key in SOURCES}
_guard = Lock()
_robots = {}
_snapshots = OrderedDict()
_latest = {}
_attempted = {}
_previews = OrderedDict()
_post_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="community-body")
_refresh_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="community-refresh")
_refreshing = set()
_log = logging.getLogger(__name__)
_body_failures = {}
_body_backoff = {}
_comment_cache = OrderedDict()
_list_cache = OrderedDict()
_list_locks = {}
_request_locks = {}
_request_next = {}


def clean(value):
    return re.sub(r"\s+", " ", re.sub(r"[\u200b-\u200f\ufeff]", "", value or "")).strip()


def html_soup(data):
    """Decode Korean bytes strictly, rather than guessing Latin-1 or losing characters.

    Valid UTF-8 wins even when an old page incorrectly declares EUC-KR.
    CP949 is the Korean legacy superset; never turn undecodable bytes into '?'.
    Literal question marks in upstream text are preserved, never guessed back.
    """
    if isinstance(data, str): return BeautifulSoup(data, "html.parser")
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try: return BeautifulSoup(data.decode(encoding, errors="strict"), "html.parser")
        except UnicodeDecodeError: continue
    raise ValueError("unsupported source encoding")


def title_key(title):
    text = unicodedata.normalize("NFKC", clean(title)).casefold()
    text = re.sub(r"\s+", "", text)
    # Decoration does not distinguish repeated registrations of the same heading.
    return text.strip("~.!?★☆●○■□◆◇▲△▼▽-=*_…ㆍ·")


def post_identity(item):
    url = urlparse(item.get("url", ""))
    params = parse_qs(url.query)
    if url.hostname in {"www.paxnet.co.kr", "paxnet.co.kr"} and params.get("seq"):
        return "pax-" + params["seq"][0]
    if url.hostname in {"www.82cook.com", "82cook.com"} and params.get("num"):
        return "82-" + params["num"][0]
    return item["id"]


def deduplicate(items):
    """Group a display index only. Original links remain available in each group."""
    identities, headings, result = {}, {}, []
    for original in sorted(items, key=lambda p: (p["published_at"], p["id"]), reverse=True):
        identity, heading = post_identity(original), title_key(original["title"])
        if identity in identities: continue
        # Generic short headings can describe unrelated discussions.
        existing = headings.get(heading) if len(heading) >= 8 else None
        if existing is not None:
            identities[identity] = existing
            existing["duplicate_count"] += 1
            if len(existing["related_posts"]) < 20:
                existing["related_posts"].append({k: original[k] for k in ("id", "title", "source", "url", "published_at") if k in original})
            continue
        item = dict(original)
        item["duplicate_count"] = original.get("duplicate_count", 0)
        item["related_posts"] = list(original.get("related_posts", []))
        identities[identity] = item
        if len(heading) >= 8: headings[heading] = item
        result.append(item)
    return result


def _request(url, form=None, referer=None):
    # Fixed, code-owned URLs only. Redirects are not followed to a new origin.
    headers = {"User-Agent": UA}
    host = urlparse(url).netloc
    with _guard: pace = _request_locks.setdefault(host, Lock())
    with pace:
        delay = _request_next.get(host, 0) - time.monotonic()
        if delay > 0: time.sleep(delay)
        _request_next[host] = time.monotonic() + (.65 if host.endswith('ppomppu.co.kr') else .35)
    if referer: headers.update({"Referer": referer, "X-Requested-With": "XMLHttpRequest"})
    # The sole POST endpoint is the upstream's read-only comment listing.
    if form is not None and url != "https://gall.dcinside.com/board/comment/": raise ValueError("unsupported read endpoint")
    r = requests.post(url, data=form, headers=headers, timeout=(4, 10), allow_redirects=False, stream=True) if form is not None else requests.get(url, headers=headers, timeout=(4, 10), allow_redirects=False, stream=True)
    try:
        r.raise_for_status()
        if r.is_redirect:
            raise ValueError("redirect")
        data = bytearray()
        for chunk in r.iter_content(65536):
            data.extend(chunk)
            if len(data) > 2_000_000:
                raise ValueError("response too large")
        return bytes(data)
    finally:
        r.close()


def _get(url, form=None, referer=None):
    host = urlparse(url).netloc
    with _guard:
        cached = _robots.get(host)
    if not cached or time.monotonic() - cached[0] > 3600:
        parser = RobotFileParser()
        try:
            rules = _request(f"https://{host}/robots.txt").decode("utf-8", "replace")
        except requests.HTTPError as error:
            # A missing robots file is not a denial. Explicit denials and server
            # failures still fail closed; do not bypass an upstream restriction.
            if error.response is None or error.response.status_code not in (404, 410): raise
            rules = ''
        parser.parse(rules.splitlines())
        cached = (time.monotonic(), parser)
        with _guard:
            _robots[host] = cached
    if not cached[1].can_fetch(UA, url):
        raise ValueError("source policy")
    return _request(url, form=form, referer=referer) if form is not None else _request(url)


def _topic(title):
    if re.search(r"금리|정책|대출|세금|규제|연준|금통위", title): return "정책·금리"
    if re.search(r"시황|증시|코스피|코스닥|나스닥|지수|환율", title): return "시황"
    if re.search(r"가격|시세|집값|매매|전세|월세|실거래|분양", title): return "시세·거래"
    if re.search(r"질문|궁금|까요|나요|어떤|어떻", title): return "질문"
    return "의견"


def _list_get(url):
    # Korea/global share the same stock boards. Coalesce their public list fetches.
    with _guard: gate = _list_locks.setdefault(url, Lock())
    with gate:
        with _guard: hit = _list_cache.get(url)
        if hit and time.monotonic() - hit[0] < 30: return hit[1]
        body = _get(url)
        with _guard:
            _list_cache[url] = (time.monotonic(), body)
            while len(_list_cache) > 32: _list_cache.popitem(last=False)
        return body


def parse_82(data, source, board):
    soup = html_soup(data)
    items = []
    for row in soup.select("tbody tr:not(.noticeList)"):
        a, date = row.select_one("td.title a"), row.select_one("td.regdate[title]")
        if not a or not date: continue
        num = parse_qs(urlparse(a.get("href", "")).query).get("num", [""])[0]
        title = clean(a.get_text())[:300]
        if not num.isdigit() or not title: continue
        if board == "kr" and re.search(r"미국|미장|해외|나스닥|테슬라|엔비디아", title): continue
        try: written = datetime.strptime(date["title"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: continue
        count = row.select_one("td.title em")
        items.append({"id": f"82-{num}", "title": title, "published_at": written,
                      "url": f"https://www.82cook.com/entiz/read.php?bn=15&num={num}",
                      "source_id": source[0], "source": source[1], "language": "ko",
                      "topic": _topic(title), "comments": int(count.get_text()) if count and count.get_text().isdigit() else None,
                      "excerpt": "", "excerpt_kind": "원문에서 본문과 댓글을 읽을 수 있습니다."})
    return items


def parse_pax(data, source, board):
    soup = html_soup(data)
    items = []
    for seq in soup.select("[data-seq]"):
        row = seq.parent
        a, date = row.select_one("a.best-title"), row.select_one("[data-date-format]")
        number = seq.get("data-seq", "")
        if not a or not date or not number.isdigit(): continue
        title = clean(a.get_text())[:300]
        # The property source searches title+body; keep a topic-specific title index.
        if board == "property" and not re.search(r"부동산|아파트|집값|전세|월세|분양|재건축|주택", title): continue
        try: written = datetime.strptime(date["data-date-format"].replace(" KST ", " "), "%a %b %d %H:%M:%S %Y").replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: continue
        comments = row.select_one(".comment-num")
        items.append({"id": f"pax-{number}", "title": title, "published_at": written,
                      "url": f"https://www.paxnet.co.kr/tbbs/view?id={source[3]}&seq={number}",
                      "source_id": source[0], "source": source[1], "language": "ko", "topic": _topic(title),
                      "comments": int(comments.get_text()) if comments and comments.get_text().isdigit() else None,
                      "excerpt": "", "excerpt_kind": "원문에서 본문과 댓글을 읽을 수 있습니다."})
    return items


_GLOBAL_TITLE = re.compile(r"미국|미장|해외|나스닥|다우|뉴욕|월가|연준|미주|테슬라|엔비디아|엔비디|애플|마이크로소프트|아마존|구글|알파벳|팔란티어|아이렌|로켓랩|소파이|오픈도어|샌디스크|브로드컴|오라클|로빈후드|모더나|넷플릭스|알리바바|홍콩증시|일본증시|니케이|TSMC|Nvidia|NASDAQ|S&P|\b(?:QQQ|TQQQ|SOXL|SCHD|JEPI|JEPQ|SPY|VOO|VTI|TSLA|NVDA|AMD|MSFT|AAPL|PLTR|GOOG|META|IREN|RKLB|SOFI|HOOD|OPEN|AVGO)\b", re.I)
_FINANCE_TITLE = re.compile(r"주식|주가|증시|시황|시총|시가총액|코스피|코스닥|국장|삼성|하이닉스|삼전|하닉|삼닉|삼하|현대차|포스코|파마리서치|금리|환율|매수|매도|물타기|물탈|투자|수익|손실|손절|익절|시드|배당|실적|거래|상장|급락|급등|반등|공매도|ETF|ETN|증권|채권|경제|계좌|주린이|연금|반도체|포트폴리오|지수|레버리지|예적금", re.I)
_PROPERTY_TITLE = re.compile(r"부동산|아파트|집값|전세|월세|분양|재건축|재개발|주택|매매|실거래|대출|청약|평당|평형|국평|토지|임대|상가|오피스텔|용적률|건폐율|집주인|세입자|다주택|1주택|2주택|양도세|보유세|종부세|취득세")
_PROMOTION_TITLE = re.compile(r"리딩방|수익보장|원금보장|종목추천방|오픈채팅|카톡방|텔레그램방|무료체험|가입이벤트|광고문의|씨발|(?<![가-힣])시발(?![가-힣])|개새끼|병신|좆|ㅅㅂ|ㅂㅅ", re.I)


def relevant_title(title, board):
    if len(title) < 6 or _PROMOTION_TITLE.search(title): return False
    if board == "property": return bool(_PROPERTY_TITLE.search(title))
    foreign = bool(_GLOBAL_TITLE.search(title))
    return foreign if board == "global" else not foreign and bool(_FINANCE_TITLE.search(title))


def source_time(value):
    for fmt in ("%y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y.%m.%d %H:%M:%S"):
        try: return datetime.strptime(clean(value), fmt).replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: pass
    return None


def listing_time(value):
    """Only explicit full dates, today's clock, or a provider-reported age.

    Rounded relative ages use the older end of that minute/hour, so a rounded
    '1 hour ago' never inflates the count of posts in the last 60 minutes.
    """
    value = clean(value)
    exact = source_time(value)
    if exact: return exact
    now = datetime.now(KST)
    if re.fullmatch(r'\d{2}:\d{2}', value):
        try: parsed = now.replace(hour=int(value[:2]), minute=int(value[3:]), second=0, microsecond=0)
        except ValueError: return None
        if parsed > now + timedelta(minutes=5): parsed -= timedelta(days=1)
        return parsed.astimezone(timezone.utc).isoformat()
    for fmt in ('%m.%d','%y.%m.%d','%Y.%m.%d'):
        try:
            parsed = datetime.strptime(value,fmt).replace(tzinfo=KST)
            if fmt == '%m.%d':
                parsed = parsed.replace(year=now.year)
                if parsed > now+timedelta(days=1): parsed=parsed.replace(year=now.year-1)
            # Midnight is only a conservative candidate time. The article's
            # full header date replaces it before publication.
            return parsed.astimezone(timezone.utc).isoformat()
        except ValueError: pass
    match = re.fullmatch(r'(\d+)\s*(분|시간)\s*전', value)
    if match:
        age = timedelta(minutes=int(match[1])+1) if match[2] == '분' else timedelta(hours=int(match[1])+1)
        return (now-age).replace(second=0,microsecond=0).astimezone(timezone.utc).isoformat()
    return None


def forum_item(source, number, title, written, url, comments=None):
    return {"id": f"{source[2]}-{source[3]}-{number}", "title": title[:300], "published_at": written,
            "url": url, "source_id": source[0], "source": source[1], "language": "ko", "topic": _topic(title),
            "comments": comments, "excerpt": "", "excerpt_kind": "공개 원문 확인"}


def parse_pp(data, source, board):
    items = []
    for row in html_soup(data).select("tr.baseList"):
        number, anchor, date = row.select_one('.baseList-numb'), row.select_one('a.baseList-title'), row.select_one('time[title]')
        if not number or not number.get_text(strip=True).isdigit() or not anchor or not date: continue
        query = parse_qs(urlparse(anchor.get('href', '')).query)
        if query.get('id') != [source[3]] or query.get('no') != [number.get_text(strip=True)]: continue
        title = clean(anchor.get_text(' ', strip=True))
        written = source_time(date['title'])
        if not written or not relevant_title(title, board): continue
        count = row.select_one('.baseList-c')
        items.append(forum_item(source, number.get_text(strip=True), title, written,
                     'https://www.ppomppu.co.kr/zboard/view.php?' + urlencode({'id':source[3], 'no':number.get_text(strip=True)}),
                     int(re.sub(r'\D','',count.get_text()) or 0) if count else None))
    return items


def parse_cl(data, source, board):
    items = []
    for row in html_soup(data).select('.list_item:not(.notice)'):
        anchor, title_node, date = row.select_one('a.list_subject'), row.select_one('.subject_fixed'), row.select_one('.timestamp')
        if not anchor or not title_node or not date: continue
        match = re.fullmatch(r'/service/board/cm_stock/(\d+)', urlparse(anchor.get('href','')).path)
        title = clean(title_node.get('title') or title_node.get_text())
        written = source_time(date.get_text())
        if not match or not written or not relevant_title(title, board): continue
        items.append(forum_item(source, match[1], title, written, 'https://www.clien.net'+match[0]))
    return items


def parse_da(data, source, board):
    items = []
    for row in html_soup(data).select('a.post-row'):
        match = re.fullmatch(r'/'+re.escape(source[3])+r'/(\d+)', urlparse(row.get('href','')).path)
        title_node, date = row.select_one('.post-title'), row.select_one('.date-today')
        if not match or not title_node or not date: continue
        title = clean(title_node.get('title') or title_node.get_text())
        value = clean(date.get_text())
        if not relevant_title(title, board) or not re.fullmatch(r'\d{2}:\d{2}',value): continue
        # Only the provider's explicitly marked "today" rows; never relabel an
        # undated/old article as current. Body JSON-LD supplies exact seconds.
        written = source_time(datetime.now(KST).strftime('%Y-%m-%d ') + value + ':00')
        if written: items.append(forum_item(source, match[1], title, written, 'https://damoang.net'+match[0]))
    return items


def parse_extra(data, source, board):
    soup, items = html_soup(data), []
    provider, channel = source[2:]
    selector = 'table.bd_lst tr:not(.notice)' if provider == 'tq' else 'tr:not(.notice):not(.popular-item)' if provider == 'dog' else 'table.board_list_table tbody tr:not(.notice)' if provider == 'rw' else 'table.clistTable02 tbody tr'
    for row in soup.select(selector):
        if provider == 'tq':
            anchor, date = row.select_one('td.title a:not(.replyNum)'), row.select_one('td.time')
            match = re.fullmatch(r'/'+re.escape(channel)+r'/(\d+)', urlparse(anchor.get('href','')).path) if anchor else None
            if not match: continue
            number = match[1]
            url = f'https://theqoo.net/{channel}/{number}'
        elif provider == 'dog':
            anchor, date = row.select_one('a:has(.title-link)'), row.select_one('td.time')
            path = urlparse(anchor.get('href','')).path if anchor else ''
            match = re.fullmatch(r'/(?:stock/)?(\d+)', path)
            if not match: continue
            number = match[1]
            url = f'https://www.dogdrip.net/stock/{number}'
        elif provider == 'rw':
            anchor, date, identifier = row.select_one('a.subject_link'),row.select_one('td.time'),row.select_one('td.id')
            if not identifier or not identifier.get_text(strip=True).isdigit(): continue
            match = re.fullmatch(r'/community/board/300143/read/(\d+)',urlparse(anchor.get('href','')).path) if anchor else None
            if not match: continue
            number=match[1]
            url='https://bbs.ruliweb.com/community/board/300143/read/'+number
        else:
            anchor, date = row.select_one('a.bsubject'), row.select_one('td.date')
            params = parse_qs(urlparse(anchor.get('href','')).query) if anchor else {}
            number = params.get('No',[''])[0]
            if params.get('code') != [channel] or not re.fullmatch(r'\d+',number): continue
            url = 'https://www.bobaedream.co.kr/view?'+urlencode({'code':channel,'No':number})
        if not anchor or not date: continue
        title_node = anchor.select_one('.title-link') if provider == 'dog' else anchor
        title = clean(title_node.get_text(' ',strip=True))
        written = listing_time(date.get('title') or date.get_text(' ',strip=True))
        if not written or not relevant_title(title, board): continue
        item = forum_item(source, number, title, written, url)
        item['time_precision'] = 'minute' if provider != 'dog' else 'source_relative'
        items.append(item)
    return items


def toss_items(source, symbol, pages=2):
    """Reuse the site's anonymous public Toss client; retain content fields only."""
    from app.data.toss_session import request_json, resolve_product_code
    product = resolve_product_code(symbol,raise_on_error=True)
    if not product: return []
    items, cursor = [], None
    for _ in range(pages):
        params = {'subjectType':'STOCK','subjectId':product,'commentSortType':'RECENT'}
        if cursor: params['lastCommentId'] = cursor
        result = request_json('GET','/api/v4/comments',host='cert',params=params,list_field='results')['result']
        rows = result.get('results') or []
        for row in rows:
            number = str(row.get('commentId') or '')
            message = row.get('message') or {}
            heading, text = clean(str(message.get('title') or '')), str(message.get('message') or '').strip()
            if not number.isdigit() or row.get('parentId') is not None or len(heading+text) < 12 or _PROMOTION_TITLE.search(heading+' '+text): continue
            try:
                date = datetime.fromisoformat(str(row.get('createdAt') or '').replace('Z','+00:00'))
                if not date.tzinfo: continue
            except ValueError: continue
            title = f'[{symbol}] '+(heading or clean(text))[:180]
            item = forum_item(source,number,title,date.astimezone(timezone.utc).isoformat(),'https://www.tossinvest.com/community/posts/'+number)
            blocks = [{'type':'paragraph','text':p.strip()} for p in re.split(r'\n\s*\n',text or heading) if p.strip()]
            item.update(id=f'toss-{symbol}-{number}',_body={'status':'ok','text':text or heading,'excerpt':text or heading,'images':[],'blocks':blocks})
            items.append(item)
        if not rows or not result.get('hasNext'): break
        next_cursor = str(result.get('key') or rows[-1].get('commentId') or '')
        if not next_cursor or next_cursor==cursor: break
        cursor = next_cursor
    return items


def collect_toss(source):
    from app.services.cache import cache
    items = []
    for symbol in TOSS_SYMBOLS:
        try:
            # Separate cache contains no author/profile data or login tokens.
            items.extend(cache.get_or_set('community-content:toss:'+symbol,60,lambda s=symbol:toss_items(source,s)))
        except Exception:
            _log.warning('Community source toss-%s unavailable',symbol)
    return items


def parse_dc(data, source, board):
    """Real creation timestamps only; pinned notices and promotions are not fresh posts."""
    soup = html_soup(data)
    items = []
    gallery = source[3]
    if gallery not in DC_GALLERIES: return items
    for row in soup.select("tr.ub-content[data-no]"):
        number = row.get("data-no", "")
        if not number.isdigit() or "notice" in row.get("data-type", ""): continue
        subject = row.select_one(".gall_subject")
        if subject and clean(subject.get_text()) in {"공지", "설문", "AD"}: continue
        a, date = row.select_one(".gall_tit > a:not(.reply_numbox)"), row.select_one(".gall_date[title]")
        if not a or not date: continue
        title = clean(a.get_text(" ", strip=True))[:300]
        if not title: continue
        if board == "property" and not re.search(r"부동산|아파트|집값|전세|월세|분양|재건축|재개발|주택|매매|실거래|대출|청약|평당|평형|국평|토지|임대|상가|오피스텔|건물|용적률|건폐율|서울|수도권|강남|서초|송파|마포|성동|용산|과천|분당|판교|동탄|광교|잠실|반포|목동|노도강|마용성|한강벨트", title): continue
        try: written = datetime.strptime(date["title"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: continue
        count = row.select_one(".reply_num")
        count_text = re.sub(r"\D", "", count.get_text()) if count else ""
        items.append({"id": f"dc-{gallery}-{number}", "title": title, "published_at": written,
                      "url": f"https://gall.dcinside.com/{DC_GALLERIES[gallery]}/view/?id={gallery}&no={number}",
                      "source_id": source[0], "source": source[1], "language": "ko", "topic": _topic(title),
                      "comments": int(count_text) if count_text else 0, "excerpt": "", "excerpt_kind": "공개 원문 확인"})
    return items


def collect(source, board):
    try:
        if source[2] == 'toss':
            items = collect_toss(source)
        elif source[2] in {'tq','dog','bb','rw'}:
            items = []
            keywords = ('부동산','아파트','전세') if board == 'property' and source[2] == 'bb' else ('',)
            if source[2]=='rw': keywords = ('부동산','아파트','전세','월세') if board=='property' else ('주식','미장','엔비디아') if board=='global' else ('주식','국장','하이닉스')
            for keyword in keywords:
                for page in range(1, 3 if keyword else 5):
                    if source[2] == 'tq':
                        params = {'mid':source[3], 'page':page}
                        if keyword: params.update(search_target='title',search_keyword=keyword)
                        url = 'https://theqoo.net/index.php?'+urlencode(params)
                    elif source[2] == 'dog':
                        url = 'https://www.dogdrip.net/stock?'+urlencode({'page':page})
                    elif source[2]=='rw':
                        url='https://bbs.ruliweb.com/community/board/300143?'+urlencode({'search_type':'subject','search_key':keyword,'page':page})
                    else:
                        params = {'code':source[3], 'page':page}
                        if keyword: params.update(col='subject',kw=keyword)
                        url = 'https://www.bobaedream.co.kr/list?'+urlencode(params)
                    try: batch = parse_extra(_list_get(url), source, board)
                    except Exception:
                        if items: break
                        raise
                    items.extend(batch)
                    if sum(datetime.fromisoformat(p['published_at']) >= datetime.now(timezone.utc)-timedelta(hours=1) for p in items) >= 20: break
        elif source[2] in {"pp", "cl", "da"}:
            items = []
            for page in range(1, 5 if source[2] == "pp" else 2):
                if source[2] == "pp":
                    url = 'https://www.ppomppu.co.kr/zboard/zboard.php?' + urlencode({'id':source[3], 'page':page})
                    try: batch = parse_pp(_list_get(url), source, board)
                    except Exception:
                        if items: break
                        raise
                elif source[2] == "cl":
                    batch = parse_cl(_list_get('https://www.clien.net/service/board/cm_stock'), source, board)
                else: batch = parse_da(_list_get('https://damoang.net/'+source[3]), source, board)
                items.extend(batch)
        elif source[2] == "dc":
            items = []
            for page in range(1, 7 if board == "property" else 4):
                url = f"https://gall.dcinside.com/{DC_GALLERIES[source[3]]}/lists/?" + urlencode({"id": source[3], "page": page})
                batch = parse_dc(_get(url), source, board)
                items.extend(batch)
                # Property's topic filter may skip a page of unrelated chatter.
                if not batch and board != "property": break
        elif source[2] == "82":
            items = []
            for page in range(1, 4):
                url = "https://www.82cook.com/entiz/enti.php?" + urlencode({"bn": "15", "searchType": "search", "search1": "1", "keys": source[3], "page": page})
                batch = parse_82(_list_get(url), source, board)
                items.extend(item for item in batch if relevant_title(item['title'], board))
                if not batch: break
            items = [item for item in items if relevant_title(item['title'], board)]
        else:
            items = []
            for page in range(1, 7 if board == "property" else 4):
                params = {"tbbsType": "S" if board == "property" else "L", "id": source[3], "page": page, "sort": "recentOrdr"}
                if board == "property": params.update({"sType": "cnt", "sText": "부동산"})
                batch = parse_pax(_list_get("https://www.paxnet.co.kr/tbbs/list?" + urlencode(params)), source, board)
                items.extend(item for item in batch if relevant_title(item['title'], board))
                if not batch: break
        if source[2] != 'dc':
            cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            items = [item for item in items if cutoff <= datetime.fromisoformat(item['published_at']) <= datetime.now(timezone.utc) + timedelta(minutes=5)]
        return items, {"id": source[0], "name": source[1], "status": "ok" if items else "empty", "count": len(items)}
    except Exception as error:
        # Do not log upstream bodies, author profiles, cookies or full URLs.
        status = error.response.status_code if isinstance(error,requests.HTTPError) and error.response is not None else None
        _log.warning('Community source %s failed: %s%s',source[0],type(error).__name__,f' HTTP {status}' if status else '')
        return [], {"id": source[0], "name": source[1], "status": "unavailable", "count": 0}


def publish(board, readable, states, old=None, checked=0, candidates=0, complete=True):
    if not complete and old:
        # Reveal new verified posts immediately without collapsing an existing
        # readable list to one row while the remaining bodies are checked.
        active = {state["id"] for state in states}
        seen = {item["id"] for item in readable}
        readable = list(readable) + [item for item in old["items"] if item["source_id"] in active and item["id"] not in seen and item.get("_body", {}).get("status") == "ok"]
    source_states = [dict(state, readable_count=sum(p["source_id"] == state["id"] for p in readable)) for state in states]
    for state in source_states:
        state["latest_published_at"] = max((p["published_at"] for p in readable if p["source_id"] == state["id"]), default=None)
    if complete:
        for state in source_states:
            if state["status"] == "ok" and not state["readable_count"]: state["status"] = "unavailable"
    data = {"snapshot": uuid.uuid4().hex, "board": board, "items": deduplicate(readable), "sources": source_states,
            "latest_published_at": max((p["published_at"] for p in readable), default=None),
            "checked_at": datetime.now(timezone.utc).isoformat(), "checked_count": checked, "candidate_count": candidates,
            "collected_at": datetime.now(timezone.utc).isoformat() if readable and any(s["status"] == "ok" for s in source_states) else (old.get("collected_at") if old else None)}
    with _guard:
        _snapshots[data["snapshot"]] = data
        _latest[board] = data["snapshot"]
        while len(_snapshots) > 64:
            key = next(k for k in _snapshots if k not in _latest.values())
            _snapshots.pop(key)
    return data


def latest(board, refresh=False):
    with _locks[board]:
        now = time.monotonic()
        previous = _latest.get(board)
        if previous and now - _attempted.get(board, 0) < (5 if refresh else 60):
            with _guard: return _snapshots[previous]
        _attempted[board] = now
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda source: collect(source, board), SOURCES[board]))
        unique, states = {}, []
        for items, state in results:
            states.append(state)
            for item in items: unique.setdefault(item["id"], item)
        # Retain the last successful source slice if just that source is unavailable.
        if previous:
            with _guard: old = _snapshots[previous]
            failed = {s["id"] for s in states if s["status"] != "ok"}
            for item in old["items"]:
                if item["source_id"] in failed: unique.setdefault(item["id"], item)
        # Publish only articles whose complete readable body or attachments were
        # actually obtained. Keep that body in the immutable reading snapshot.
        _log.info("Community %s: checking %s public candidates", board, len(unique))
        ordered = sorted(unique.values(), key=lambda p: (p["published_at"], p["id"]), reverse=True)
        # Bound cold-start work; the newest hour always comes first. Cached
        # successful bodies make subsequent minute refreshes inexpensive.
        candidates = iter(ordered[:160])
        # Keep only four queued jobs per board, so one cold board cannot monopolize
        # the shared pool. Publish completed, readable bodies without waiting for
        # the slowest origin request in the entire collection.
        pending = {_post_pool.submit(verified_post, item) for item in islice(candidates, 4)}
        readable, checked, last_publish = [], 0, time.monotonic()
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                item = future.result()
                checked += 1
                if item is not None: readable.append(item)
                next_item = next(candidates, None)
                if next_item is not None: pending.add(_post_pool.submit(verified_post, next_item))
            if readable and (len(readable) == 1 or checked % 10 == 0 or time.monotonic() - last_publish >= 2):
                publish(board, readable, states, old if previous else None, checked, min(len(unique),160), complete=False)
                last_publish = time.monotonic()
        _log.info("Community %s: ready %s of %s checked", board, len(readable), checked)
        return publish(board, readable, states, old if previous else None, checked, min(len(unique),160))


def responsive_latest(board, refresh=False):
    with _guard:
        key = _latest.get(board)
        data = _snapshots.get(key)
        due = time.monotonic() - _attempted.get(board, 0) >= (5 if refresh else 60)
        launch = (data is None or due) and board not in _refreshing
        if launch: _refreshing.add(board)
    if launch:
        def update():
            try: latest(board, refresh)
            finally:
                with _guard: _refreshing.discard(board)
        _refresh_pool.submit(update)
    with _guard:
        refreshing = board in _refreshing
        data = _snapshots.get(_latest.get(board), data)
    if data is None:
        data = {"snapshot": "", "board": board, "items": [], "sources": [{"id": s[0], "name": s[1], "status": "pending", "count": 0} for s in SOURCES[board]], "checked_at": datetime.now(timezone.utc).isoformat(), "collected_at": None}
    return data, refreshing


def listing(board, page=1, snapshot=None, query="", source="", topic="", refresh=False, background=False):
    refreshing = False
    if snapshot:
        with _guard: data = _snapshots.get(snapshot)
        if not data or data["board"] != board: raise LookupError("snapshot expired")
    elif background: data, refreshing = responsive_latest(board, refresh)
    else: data = latest(board, refresh)
    items = [i for i in data["items"] if (not query or query.casefold() in i["title"].casefold()) and (not source or i["source_id"] == source) and (not topic or i["topic"] == topic)]
    public_items = [{k: v for k, v in item.items() if k != "_body"} for item in items[(page-1)*50:page*50]]
    now = datetime.now(timezone.utc)
    recent = sum(now-timedelta(hours=1) <= datetime.fromisoformat(p['published_at']) <= now for p in items)
    return {k: v for k, v in data.items() if k != "items"} | {"items": public_items, "total": len(items), "page": page, "page_size": 50, "pages": max(1, (len(items)+49)//50), "refresh_seconds": 60, "refreshing": refreshing, "recent_hour_count":recent, "hourly_target":10, "hourly_target_met":recent>=10, "grouped_duplicates": sum(p.get("duplicate_count", 0) for p in items)}


def attachment_url(value, base):
    if not value or len(value) > 2048: return None
    url = urlparse(urljoin(base, value.strip()))
    if url.scheme not in {"https", "http"} or url.username or url.password: return None
    allowed = {"www.paxnet.co.kr", "paxnet.co.kr", "image.paxnet.co.kr", "img.paxnet.co.kr", "www.82cook.com", "82cook.com", "gall.dcinside.com", "image.dcinside.com"}
    allowed.update(f"dcimg{i}.dcinside.{suffix}" for i in range(1, 10) for suffix in ("com", "co.kr"))
    if url.hostname not in allowed and not any(url.hostname == root or url.hostname.endswith('.'+root) for root in ('ppomppu.co.kr','clien.net','damoang.net','theqoo.net','dogdrip.net','bobaedream.co.kr','ruliweb.com')): return None
    try:
        if url.port not in {None, 80, 443}: return None
    except ValueError: return None
    if re.search(r"\.(?:svg|html?|js)(?:$|[/?])", url.path, re.I): return None
    return urlunparse(("https", url.hostname, url.path, url.params, url.query, ""))


_CONTROL_WORD = r"(?:공유하기|공유|페이스북|트위터|네이버\s*밴드|밴드|스크랩|카카오\s*스토리|카카오톡|라인|URL\s*복사|닫기)"
_CONTROL_RUN = re.compile(r"(?<![가-힣A-Za-z])(?:0\s+)?" + _CONTROL_WORD + r"(?:\s+" + _CONTROL_WORD + r"){2,}(?![가-힣A-Za-z])", re.I)
_HTML_TAG = re.compile(r"</?(?:iframe|script|style|object|embed|video|div|p|br|img|a|span|strong|em|b|i|button|input|form|nav|section|article|ul|ol|li)\b[^>]*>", re.I)
_URL = re.compile(r"https?://[^\s<>\"']+", re.I)


def youtube_video(value):
    value = unescape(value or "").strip().split()
    if not value: return None
    raw = value[0].rstrip(".,;!)]}↗")
    if raw.startswith("//"): raw = "https:" + raw
    url = urlparse(raw)
    if url.scheme not in {"http", "https"} or url.username or url.password: return None
    host = url.hostname
    parts = url.path.strip("/").split("/")
    video_id = None
    if host in {"youtu.be", "www.youtu.be"} and len(parts) == 1:
        video_id = parts[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}:
        if len(parts) == 2 and parts[0] in {"embed", "shorts", "live"}: video_id = parts[1]
        elif url.path == "/watch": video_id = parse_qs(url.query).get("v", [None])[0]
    if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id): return None
    return {"video_id": video_id, "title": "유튜브 영상", "portrait": bool(parts and parts[0] == "shorts")}


def expand_literal_html(content):
    # Some boards store embed markup as escaped text, including nested entities.
    # Parse only recognized HTML fragments; all output is still structured data.
    for _ in range(3):
        changed = False
        for node in list(content.find_all(string=True)):
            if isinstance(node, Comment) or node.parent is None or node.parent.name in {"script", "style"}: continue
            candidate = unescape(str(node))
            if not _HTML_TAG.search(candidate): continue
            fragment = BeautifulSoup(candidate, "html.parser")
            node.replace_with(*list(fragment.contents))
            changed = True
        if not changed: break


def clean_body_controls(content):
    # UI chrome is not article content. Also handle menus pasted as plain text
    # into a forum post: require a run of controls containing a UI action.
    for el in content.select("script,style,object,embed,video,form,noscript,button,input,select,textarea,nav,[role='button'],[role='navigation'],.share,.sns,.social-share,.article-share,.share-tools,.sns-area,.share-area,.social-tools"):
        if el.parent is not None: el.decompose()
    for el in content.select("iframe"):
        if not youtube_video(el.get("src", "")): el.decompose()
    for el in content.select("a[href]"):
        if re.fullmatch(_CONTROL_WORD, clean(el.get_text(" ", strip=True)), re.I) and re.search(r"javascript:|share|sharer|intent/|scrap|copy|kakao", el.get("href", ""), re.I):
            el.decompose()


def readable_text(text):
    text = _CONTROL_RUN.sub(lambda m: "\n\n" if re.search(r"공유|스크랩|URL\s*복사", m.group(), re.I) else m.group(), text)
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text).replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(re.sub(r"[^\S\n]+", " ", line).strip() for line in text.split("\n"))).strip()


def public_link(value, base):
    if not value: return None
    url = urlparse(urljoin(base, value.strip()))
    if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password: return None
    return url.geturl()


def article_metadata(soup, host):
    """Provider-owned article header only; never author or comment metadata."""
    title, written = '', None
    if host == 'theqoo.net':
        heading = soup.select_one('.rd_hd .title')
        title = clean(heading.get_text(' ',strip=True)) if heading else ''
        date = soup.select_one('.rd_hd .btm_area .side.fr')
    elif host == 'www.bobaedream.co.kr':
        title = clean(soup.title.get_text().split(' | ')[0]) if soup.title else ''
        date = soup.select_one('.countGroup')
    elif host == 'www.dogdrip.net':
        title = clean(soup.title.get_text().split(' - DogDrip')[0]) if soup.title else ''
        date = soup.select_one('.article-head .title-toolbar')
        if date:
            for node in date.select('span'):
                written = listing_time(node.get_text(' ',strip=True))
                if written: break
        return title, written
    elif host == 'bbs.ruliweb.com':
        heading=soup.select_one('.subject_text')
        title=clean(heading.get_text(' ',strip=True)) if heading else ''
        date=soup.select_one('span.regdate')
    elif host == 'www.paxnet.co.kr':
        meta = soup.select_one('meta[property="og:title"]')
        title = clean(meta.get('content','')) if meta else clean(soup.title.get_text().split(' | ')[0]) if soup.title else ''
        node = soup.select_one('[data-date-format]')
        if node:
            try: written = datetime.strptime(node['data-date-format'].replace(' KST ',' '),'%a %b %d %H:%M:%S %Y').replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
            except ValueError:
                written=source_time(re.sub(r'\.\d+$','',node['data-date-format']))
        return title, written
    else: return title, written
    match = re.search(r'(20\d{2}[.]\d{2}[.]\d{2})[^\d]*(\d{2}:\d{2}(?::\d{2})?)',date.get_text(' ',strip=True) if date else '')
    if match: written = source_time(match[1]+' '+match[2])
    return title, written


def parse_preview(data, url, is_pax=True):
    soup = html_soup(data)
    host = urlparse(url).hostname
    selector = {"www.ppomppu.co.kr": ".JS_ContentMain .han, .JS_ContentMain", "www.clien.net": "article.post .content, .post_article", "damoang.net": "#economy-post-content, .prose", "theqoo.net": ".rd_body .xe_content", "www.dogdrip.net": "[class*=document_].xe_content", "www.bobaedream.co.kr": ".bodyCont", "bbs.ruliweb.com":".view_content article"}.get(host)
    if not selector: selector = ".write_div" if host == "gall.dcinside.com" else "#bbsWrtCntn" if is_pax else "#articleBody, .read_cont, .read_content, #readContent"
    content = soup.select_one(selector)
    if not content: return {"text": "", "excerpt": "", "images": [], "blocks": [], "status": "unavailable"}
    expand_literal_html(content)
    for control in content.select(".appending_file, .dcappfooter, .og-div, .og-url"):
        control.decompose()
    clean_body_controls(content)
    images, seen, blocks, buffer = [], set(), [], []
    seen_videos = set()

    def add_video(video):
        if video["video_id"] not in seen_videos:
            seen_videos.add(video["video_id"])
            blocks.append({"type": "youtube", **video})

    def paragraph(text):
        if text.strip(): blocks.extend({"type": "paragraph", "text": p} for p in text.strip().split("\n\n") if p.strip())

    def flush():
        text = readable_text("".join(buffer))
        buffer.clear()
        start = 0
        for match in _URL.finditer(text):
            video = youtube_video(match.group())
            if not video: continue
            paragraph(text[start:match.start()])
            add_video(video)
            start = match.end()
        paragraph(text[start:])

    def walk(node):
        if isinstance(node, Comment): return
        if isinstance(node, NavigableString):
            buffer.append(str(node))
            return
        if not isinstance(node, Tag): return
        if node.name == "iframe":
            video = youtube_video(node.get("src", ""))
            if video:
                flush()
                width, height = node.get("width", ""), node.get("height", "")
                if str(width).isdigit() and str(height).isdigit() and int(width) > 0:
                    video["portrait"] = int(height) > int(width) * 1.2
                title = clean(node.get("title", ""))
                if title: video["title"] = title[:160]
                add_video(video)
            return
        if node.name == "br":
            buffer.append("\n")
            return
        if node.name == "img":
            dimensions = [int(node[a]) for a in ("width", "height") if str(node.get(a, "")).isdigit()]
            if any(n <= 2 for n in dimensions): return
            candidates = [node.get(a) for a in ("data-original", "data-src", "data-lazy-src", "src")]
            src = next((safe for value in candidates if (safe := attachment_url(value, url))), None)
            if not src or src in seen: return
            seen.add(src)
            image = {"url": src, "alt": clean(node.get("alt", ""))[:160] or f"첨부 이미지 {len(images) + 1}"}
            images.append(image)
            flush()
            blocks.append({"type": "image", **image})
            return
        block = node.name in {"p", "div", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "ul", "ol", "table", "tr"}
        if block: buffer.append("\n\n")
        if node.name == "li": buffer.append("\n• ")
        if node.name in {"td", "th"}: buffer.append("  ")
        for child in node.children: walk(child)
        if node.name == "a" and node.get_text(strip=True):
            href = public_link(node.get("href"), url)
            if href and href != node.get_text(strip=True): buffer.append(f" ({href})")
        if block: buffer.append("\n\n")

    walk(content)
    flush()
    text = "\n\n".join(b["text"] for b in blocks if b["type"] == "paragraph")
    # The legacy response field remains for older clients, but is no longer truncated.
    result = {"text": text, "excerpt": text, "images": images, "blocks": blocks, "status": "ok" if blocks else "empty"}
    if host in {'theqoo.net','www.bobaedream.co.kr','bbs.ruliweb.com'}:
        written = article_metadata(soup,host)[1]
        if written: result['published_at'] = written
    if host == 'damoang.net':
        for node in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(node.get_text())
                for entry in data if isinstance(data, list) else [data]:
                    if entry.get('@type') == 'DiscussionForumPosting':
                        date = datetime.fromisoformat(entry['datePublished'].replace('Z','+00:00'))
                        if date.tzinfo: result['published_at'] = date.astimezone(timezone.utc).isoformat()
            except (ValueError, KeyError, TypeError, AttributeError): pass
    return result


def load_post(item):
    post_id = item["id"]
    with _guard: cached = _previews.get(post_id)
    ttl = 300 if cached and cached[1].get("status") == "ok" else 30
    if cached and time.monotonic() - cached[0] < ttl: return cached[1]
    result = {"text": "", "excerpt": "", "images": [], "blocks": [], "status": "unavailable"}
    # A source may expose search headings while requiring login for every body.
    # Stop repeatedly requesting that source after confirmed failures; never
    # bypass its access controls, and periodically permit a fresh public check.
    host = urlparse(item["url"]).hostname
    with _guard:
        if _body_backoff.get(host, 0) > time.monotonic(): return result
    for attempt in range(2):
        try:
            result = parse_preview(_get(item["url"]), item["url"], item["id"].startswith("pax-"))
            break
        except (requests.Timeout, requests.ConnectionError):
            if attempt: break
        except requests.HTTPError as error:
            if error.response is not None and error.response.status_code in (403,429):
                with _guard: _body_backoff[host] = time.monotonic()+60
            break
        except Exception: break
    with _guard:
        if item["id"].startswith(("82-", "dc-")):
            if result["status"] == "ok":
                _body_failures[host] = 0
                _body_backoff[host] = 0
            else:
                _body_failures[host] = _body_failures.get(host, 0) + 1
                if _body_failures[host] >= 3:
                    _body_backoff[host] = time.monotonic() + 120
                    _body_failures[host] = 0
        _previews[post_id] = (time.monotonic(), result)
        while len(_previews) > 256: _previews.popitem(last=False)
    return result


def verified_post(item):
    body = item.get("_body") or load_post(item)
    if body.get("status") != "ok" or not body.get("blocks"): return None
    return dict(item, _body=body, published_at=body.get('published_at') or item['published_at'])


def entry(board, post_id, snapshot=None):
    """A stable internal article link, including after its list snapshot expires.

    Destinations are reconstructed only from active provider IDs, never a URL
    supplied by a visitor. Opening an article does not replace the board feed.
    """
    with _guard:
        data = _snapshots.get(snapshot)
        snapshots = [data] if data and data['board'] == board else [s for s in reversed(list(_snapshots.values())) if s['board'] == board]
        for data in snapshots:
            item = next((p for p in data['items'] if p['id'] == post_id), None)
            if item: return {'post': {k:v for k,v in item.items() if k != '_body'}, 'snapshot':data['snapshot']}
    toss_match = re.fullmatch(r'toss-([A-Z]+)-(\d{1,20})',post_id)
    if toss_match and board == 'global' and toss_match[1] in TOSS_SYMBOLS:
        source = next(s for s in SOURCES[board] if s[2]=='toss')
        item = next((p for p in toss_items(source,toss_match[1],pages=6) if p['id']==post_id),None)
        if not item: raise LookupError('article unavailable')
        key = uuid.uuid4().hex
        with _guard:
            _snapshots[key] = {'snapshot':key,'board':board,'items':[item],'sources':[]}
            while len(_snapshots)>64: _snapshots.pop(next(k for k in _snapshots if k not in _latest.values()))
        return {'post':{k:v for k,v in item.items() if k!='_body'},'snapshot':key}
    source, url = None, None
    for candidate in SOURCES[board]:
        prefix = candidate[2]+'-' if candidate[2] in {'82','pax'} else f'{candidate[2]}-{candidate[3]}-'
        number = post_id.removeprefix(prefix)
        if not post_id.startswith(prefix) or not re.fullmatch(r'\d{1,20}',number): continue
        source = candidate
        if candidate[2] == 'pp': url = 'https://www.ppomppu.co.kr/zboard/view.php?'+urlencode({'id':candidate[3],'no':number})
        elif candidate[2] == 'cl': url = 'https://www.clien.net/service/board/cm_stock/'+number
        elif candidate[2] == 'da': url = 'https://damoang.net/'+candidate[3]+'/'+number
        elif candidate[2] == '82': url = 'https://www.82cook.com/entiz/read.php?'+urlencode({'bn':'15','num':number})
        elif candidate[2] == 'tq': url = 'https://theqoo.net/'+candidate[3]+'/'+number
        elif candidate[2] == 'dog': url = 'https://www.dogdrip.net/stock/'+number
        elif candidate[2] == 'bb': url = 'https://www.bobaedream.co.kr/view?'+urlencode({'code':candidate[3],'No':number})
        elif candidate[2] == 'pax': url = 'https://www.paxnet.co.kr/tbbs/view?'+urlencode({'id':candidate[3],'seq':number})
        elif candidate[2] == 'rw': url = 'https://bbs.ruliweb.com/community/board/300143/read/'+number
        break
    if not source or not url: raise LookupError('article unavailable')
    raw = _get(url)
    soup = html_soup(raw)
    title, written = article_metadata(soup,urlparse(url).hostname)
    def metadata(node):
        nonlocal title, written
        if isinstance(node, list):
            for child in node: metadata(child)
        elif isinstance(node, dict):
            if node.get('@type') in ('Article','DiscussionForumPosting','BlogPosting'):
                title = title or clean(node.get('headline',''))
                if not written and node.get('datePublished'):
                    try:
                        parsed = datetime.fromisoformat(node['datePublished'].replace('Z','+00:00'))
                        if parsed.tzinfo: written = parsed.astimezone(timezone.utc).isoformat()
                    except ValueError: pass
            if '@graph' in node: metadata(node['@graph'])
    for script in soup.select('script[type="application/ld+json"]'):
        try: metadata(json.loads(script.get_text()))
        except (ValueError, TypeError): pass
    if not title:
        meta = soup.select_one('meta[property="og:title"]')
        heading = soup.select_one('h4.bbstitle') or soup.select_one('.read_title') or soup.select_one('article h1') or soup.select_one('h1')
        title = clean(meta.get('content','') if meta else heading.get_text() if heading else '')
    if not written:
        node = soup.select_one('time[datetime]')
        if node:
            try: written = datetime.fromisoformat(node['datetime']).astimezone(timezone.utc).isoformat()
            except ValueError: pass
    if not written and source[2] == '82':
        node = soup.select_one('.readRight')
        match = re.search(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', node.get_text() if node else '')
        if match: written = source_time(match[0])
    if not written or not relevant_title(title, board): raise LookupError('article metadata unavailable')
    body = parse_preview(raw, url, source[2]=='pax')
    if body['status'] != 'ok': raise ValueError('article body unavailable')
    item = forum_item(source, number, title, written, url)
    item.update(id=post_id, _body=body)
    key = uuid.uuid4().hex
    with _guard:
        _snapshots[key] = {'snapshot':key, 'board':board, 'items':[item], 'sources':[{'id':source[0], 'name':source[1], 'status':'ok', 'count':1}],
                           'collected_at':datetime.now(timezone.utc).isoformat(), 'checked_at':datetime.now(timezone.utc).isoformat(), 'latest_published_at':written}
        while len(_snapshots) > 64:
            _snapshots.pop(next(k for k in _snapshots if k not in _latest.values()))
    return {'post': {k:v for k,v in item.items() if k != '_body'}, 'snapshot':key}


def preview(board, snapshot, post_id):
    with _guard:
        data = _snapshots.get(snapshot)
        item = next((p for p in data["items"] if p["id"] == post_id), None) if data and data["board"] == board else None
    if not item: raise LookupError("snapshot expired")
    return item.get("_body") or load_post(item)


def parse_comments(data, source_url, page=1):
    soup = html_soup(data)
    scripts = "\n".join(s.get_text() for s in soup.select('script'))
    count = re.search(r'''\$\(["']#commentCnt["']\)\.html\(["'](\d+)["']\)''', scripts)
    total = int(count[1]) if count else None
    last_page = re.search(r'''if\(\s*["'](\d+)["']\s*==\s*["'](\d+)["']\s*\)\s*\{\s*\$\(["']#und-list["']\)\.hide\(\)''', scripts)
    items, seen = [], set()
    for node in soup.select('.text[id^="text_"]'):
        comment_id = node.get('id', '').removeprefix('text_')
        content = node.find('p', class_='cont', recursive=False)
        if not comment_id.isdigit() or comment_id in seen or content is None: continue
        body = parse_preview(f'<div id="bbsWrtCntn">{content}</div>', source_url)
        if not body['blocks']: continue
        seen.add(comment_id)
        date = node.select_one('.data-date-format')
        written = None
        if date:
            try: written = datetime.strptime(date['data-date-format'].replace(' KST ', ' '), '%a %b %d %H:%M:%S %Y').replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
            except (KeyError, ValueError): pass
        thread = node.find_parent('li', class_='list')
        parent = thread.select_one('.text[id^="text_"]') if thread else None
        parent_id = parent.get('id', '').removeprefix('text_') if parent else None
        if parent_id == comment_id: parent_id = None
        action = node.select_one('button[onclick*="replyAddForm"]')
        relation = re.search(r'''replyAddForm\(\s*["']\d+["']\s*,\s*this\s*,\s*["'](\d+)["']''', action.get('onclick', '')) if action else None
        if relation and relation[1] != '0': parent_id = relation[1]
        # No writer ID, nickname, profile URL or profile image enters the response.
        items.append({'id': comment_id, 'parent_id': parent_id, 'published_at': written, 'blocks': body['blocks']})
    if not items and total is None:
        return {'status': 'unavailable', 'items': [], 'total': None, 'has_more': False, 'page': page}
    has_more = bool(items) and (last_page[1] != last_page[2] if last_page else total is not None and total > page * len(items))
    return {'status': 'ok', 'items': items, 'total': total, 'has_more': has_more, 'page': page}


def parse_dc_comments(data, source_url, page=1):
    """Project only public content; discard names, IPs, user IDs and profile fields."""
    payload = json.loads(data) if isinstance(data, (str, bytes)) else data
    if not isinstance(payload, dict) or not str(payload.get("total_cnt", "")).isdigit():
        return {"status": "unavailable", "items": [], "total": None, "has_more": False, "page": page}
    rows = payload.get("comments") or []
    items = []
    now = datetime.now(KST)
    for row in rows if isinstance(rows, list) else []:
        number, parent = str(row.get("no", "")), str(row.get("c_no", "0"))
        if not number.isdigit() or row.get("del_yn") == "Y" or str(row.get("is_delete", "0")) != "0": continue
        body = parse_preview('<div class="write_div">' + str(row.get("memo") or "") + '</div>', source_url)
        if not body["blocks"]: continue
        written = None
        date = str(row.get("reg_date", ""))
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M:%S", "%m.%d %H:%M:%S", "%m.%d %H:%M"):
            try:
                parsed = datetime.strptime(date, fmt).replace(tzinfo=KST)
                if not fmt.startswith("%Y"):
                    parsed = parsed.replace(year=now.year)
                    if parsed > now + timedelta(days=1): parsed = parsed.replace(year=now.year - 1)
                written = parsed.astimezone(timezone.utc).isoformat()
                break
            except ValueError: continue
        items.append({"id": number, "parent_id": parent if parent.isdigit() and parent != "0" else None, "published_at": written, "blocks": body["blocks"]})
    total = int(payload["total_cnt"])
    # Use upstream pagination; reply counts can exceed the parent-page size.
    soup = html_soup(str(payload.get("pagination") or ""))
    pages = [int(n) for a in soup.select("a") for n in re.findall(r"(?:comment_page|viewComments)\s*[=(]\s*['\"]?(\d+)", a.get("href", "") + " " + a.get("onclick", ""))]
    return {"status": "ok", "items": items, "total": total, "has_more": bool(items) and max(pages, default=page) > page, "page": page}


def dc_comments(item, page):
    query = parse_qs(urlparse(item["url"]).query)
    gallery, number = query.get("id", [""])[0], query.get("no", [""])[0]
    if gallery not in DC_GALLERIES or not number.isdigit(): raise ValueError("invalid gallery")
    soup = html_soup(_get(item["url"]))
    token = soup.select_one("#e_s_n_o")
    if not token or not token.get("value"): raise ValueError("public comments unavailable")
    # Upstream's own read-only listing protocol. Public capability stays in memory.
    data = _get("https://gall.dcinside.com/board/comment/", form={"id": gallery, "no": number, "cmt_id": gallery, "cmt_no": number, "e_s_n_o": token["value"], "comment_page": page, "sort": "D", "prevCnt": "", "_GALLTYPE_": "G" if gallery == "immovables" else "M"}, referer=item["url"])
    return parse_dc_comments(data, item["url"], page)


def comments(board, snapshot, post_id, page=1):
    with _guard:
        data = _snapshots.get(snapshot)
        item = next((p for p in data['items'] if p['id'] == post_id), None) if data and data['board'] == board else None
        cached = _comment_cache.get((post_id, page))
    if not item: raise LookupError('snapshot expired')
    if cached and time.monotonic() - cached[0] < 30: return cached[1]
    result = {'status': 'unavailable', 'items': [], 'total': None, 'has_more': False, 'page': page}
    if item['id'].startswith(('pp-','da-','cl-','82-','tq-','dog-','bb-','toss-','rw-')):
        return {**result, 'status':'unsupported'}
    query = parse_qs(urlparse(item['url']).query)
    bbs_id, seq = query.get('id', [''])[0], query.get('seq', [''])[0]
    if item['id'].startswith('dc-'):
        try: result = dc_comments(item, page)
        except Exception: pass
    if item['id'].startswith('pax-') and re.fullmatch(r'N\d{1,10}', bbs_id) and re.fullmatch(r'\d{1,20}', seq):
        url = 'https://www.paxnet.co.kr/tbbs/bbsCommentList?' + urlencode({'id': bbs_id, 'seq': seq, 'page': page, 'orderType': '', 'commentSeq': 0, 'modCmt': 'N'})
        try: result = parse_comments(_get(url), item['url'], page)
        except Exception: pass
    with _guard:
        _comment_cache[(post_id, page)] = (time.monotonic(), result)
        while len(_comment_cache) > 256: _comment_cache.popitem(last=False)
    return result
