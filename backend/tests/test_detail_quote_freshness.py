"""Exercise the actual quote handlers against an isolated in-memory cache only.

Extract just each function so importing application routers cannot initialize stores.
"""
import ast
from pathlib import Path

import pytest

from app.services import cache as cache_module


@pytest.mark.parametrize("router,code", [("stock", "005930"), ("us_stock", "AAPL")])
def test_next_five_second_poll_receives_refreshed_quote(monkeypatch, router, code):
    tree = ast.parse((Path(__file__).parents[1] / "app" / "routers" / f"{router}.py").read_text(encoding="utf-8"))
    ttl = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == "TTL_QUOTE_SECONDS" for t in n.targets))
    handler = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "quote")
    handler.decorator_list = []
    now = [100.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: now[0])
    fresh_cache = cache_module.TTLCache()
    fetched = []
    def upstream(*args, **kwargs):
        fetched.append(True)
        return {"code": code, "close": 100 + len(fetched)}
    scope = {"cache": fresh_cache, "TTL_QUOTE_SECONDS": ttl,
             "_resolve_name": lambda code: "fixture", "_resolve_item": lambda code: {"name": "fixture"},
             "get_stock_quote": upstream, "get_us_stock_quote": upstream}
    exec(compile(ast.Module(body=[handler], type_ignores=[]), "quote_handler_fixture", "exec"), scope)
    assert scope["quote"](code)["close"] == 101
    now[0] += 1
    assert scope["quote"](code)["close"] == 101
    assert len(fetched) == 1
    now[0] += 4
    assert scope["quote"](code)["close"] == 102
    assert len(fetched) == 2
    assert ttl < 5
