import threading

import pytest

from app.services.libsql_gate import Gate, StoreUnavailable


def _hold_until(gate, release):
    """Occupies the gate on a background thread until `release` is set."""
    started = threading.Event()

    def run():
        with gate.hold():
            started.set()
            release.wait(5)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    assert started.wait(2)
    return thread


def test_busy_timeouts_do_not_open_the_breaker():
    """A queue that outlasts the acquire timeout is a load signal, not an outage.

    This is the regression that took the AI 예측 page down: prediction_store's reads
    are seconds long, so a few honest readers arriving together exhausted the wait,
    and counting each of those as a failure opened the breaker on the fourth — turning
    a burst into a cooldown during which every endpoint on that store returned 503.
    """
    gate = Gate("test", lock_timeout=0.05, fail_threshold=2, cooldown=30)
    release = threading.Event()
    thread = _hold_until(gate, release)
    try:
        for _ in range(5):
            with pytest.raises(StoreUnavailable, match="busy for over"):
                with gate.hold():
                    pass
        assert not gate.is_open
    finally:
        release.set()
        thread.join(2)

    # And the gate still works once the queue drains.
    with gate.hold():
        pass


def test_real_errors_still_open_the_breaker():
    gate = Gate("test", lock_timeout=1, fail_threshold=2, cooldown=30)
    for _ in range(2):
        with pytest.raises(RuntimeError):
            with gate.hold():
                raise RuntimeError("upstream is down")

    assert gate.is_open
    with pytest.raises(StoreUnavailable, match="cooling down"):
        with gate.hold():
            pass


def test_one_clean_call_closes_the_breaker():
    gate = Gate("test", lock_timeout=1, fail_threshold=2, cooldown=0)
    for _ in range(2):
        with pytest.raises(RuntimeError):
            with gate.hold():
                raise RuntimeError("upstream is down")

    # cooldown=0 means the window has already elapsed, so the next call gets through
    # and its success resets the failure count rather than leaving it primed to reopen.
    with gate.hold():
        pass
    assert not gate.is_open
