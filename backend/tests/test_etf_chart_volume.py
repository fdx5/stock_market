"""Exercise chart parsing with isolated responses, without app or DB imports."""
import ast
from pathlib import Path
from types import SimpleNamespace

import pytest


def read_quote(meta_volume, bars):
    source = ast.parse((Path(__file__).parents[1] / 'app/services/etf_market.py').read_text(encoding='utf-8'))
    function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == '_fetch_us_chart_quote')
    result = {'meta': {'currency': 'USD', 'regularMarketVolume': meta_volume}, 'indicators': {'quote': [{'volume': bars}]}}
    response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'chart': {'result': [result]}})
    env = {'requests': SimpleNamespace(get=lambda *_args, **_kwargs: response), 'YAHOO_CHART_PARAMS': {}, 'YAHOO_HEADERS': {},
           'US_CHART_FALLBACK_TIMEOUT_SECONDS': 1, 'extract_quote': lambda _result: {'price': 101, 'previous_close': 100, 'session': 'pre'}}
    exec(compile(ast.Module(body=[function], type_ignores=[]), 'etf-chart-fixture', 'exec'), env)
    return env['_fetch_us_chart_quote']('SPY')[1]


def test_premarket_zero_bars_keep_the_real_regular_session_volume():
    quote = read_quote(31_454_797, [0, None, 0])
    assert quote['volume'] == 31_454_797
    assert quote['close'] == 101 and quote['session'] == 'pre'


def test_an_explicit_zero_regular_volume_is_not_replaced_by_extended_volume():
    assert read_quote(0, [10, 20])['volume'] == 0


@pytest.mark.parametrize('missing', [None, -1, 'unavailable', float('nan')])
def test_unavailable_metadata_keeps_the_bar_volume_recovery(missing):
    assert read_quote(missing, [10, None, 20])['volume'] == 30
