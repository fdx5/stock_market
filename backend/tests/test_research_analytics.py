"""Run only the new SELECT function against a brand-new temporary SQLite file."""
import ast
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_research_counts_and_filter_use_existing_events_without_mutation(tmp_path):
    source = (ROOT / 'app/services/page_view_store.py').read_text(encoding='utf-8')
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'research_stats')
    conn = sqlite3.connect(tmp_path / 'brand-new-research.sqlite')
    conn.execute('CREATE TABLE page_views (session_id TEXT,path TEXT,created_at TEXT,event_type TEXT,is_bot INTEGER,object_key TEXT,stock_code TEXT,stock_name TEXT)')
    rows = [
        ('a','/stock-context','2026-10-25T01:00:00+00:00','page_view',0,None,None,None),
        ('a','/stock-context','2026-10-25T02:00:00+00:00','page_view',0,None,None,None),
        ('a','/stock-context','2026-10-25T02:01:00+00:00','click',0,'research:symbol_select','AAPL','Apple'),
        ('a','/stock-context','2026-10-25T02:02:00+00:00','click',0,'research:symbol_apply','AAPL',None),
        ('bot','/stock-context','2026-10-25T02:03:00+00:00','page_view',1,None,None,None),
        ('b','/etf-overlap','2026-10-25T02:00:00+00:00','page_view',0,None,None,None),
        ('b','/desk','2026-10-25T02:00:00+00:00','page_view',0,None,None,None),
    ]
    conn.executemany('INSERT INTO page_views VALUES (?,?,?,?,?,?,?,?)', rows)
    before = conn.execute('SELECT * FROM page_views').fetchall()
    statements=[];conn.set_trace_callback(statements.append)
    namespace={'HUMAN':'is_bot IS NOT 1','_with_connection':lambda fn:fn(conn)}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'research_stats','exec'),namespace)
    data=namespace['research_stats']('2026-10-24T00:00:00+00:00')
    assert len(data['pages']) == 36
    stock=next(r for r in data['pages'] if r['path']=='/stock-context')
    assert (stock['views'],stock['sessions'],stock['actions']) == (2,1,2)
    assert len(data['actions']) == 2 and len(data['recent']) == 2
    assert data['trend'][0]['views'] == 3
    selected=namespace['research_stats']('2026-10-24T00:00:00+00:00','/etf-overlap')
    assert len(selected['pages'])==1 and selected['pages'][0]['views']==1
    assert not selected['recent']
    assert all(sql.lstrip().upper().startswith('SELECT') for sql in statements)
    assert conn.execute('SELECT * FROM page_views').fetchall() == before
    conn.close()


def test_research_admin_endpoint_requires_existing_admin_auth():
    source=(ROOT/'app/routers/admin.py').read_text(encoding='utf-8')
    module=ast.parse(source)
    endpoint=next(n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='research_stats')
    assert any('require_admin' in ast.unparse(d) for d in endpoint.decorator_list)
    assert '422' in ast.unparse(endpoint)
