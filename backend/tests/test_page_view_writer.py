"""The page-view writer must not lose visits to a store that is merely busy.

Every test runs against a fresh temporary database (tmp_path); no existing store is touched.
"""
import queue
import threading

import pytest

from app.services import activity_log, libsql_gate, page_view_store
from app.services.libsql_gate import StoreUnavailable


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.setattr(page_view_store, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(page_view_store, "LOCAL_DB_PATH", tmp_path / "page_views.db")
    monkeypatch.setattr(page_view_store, "_conn", None)
    yield page_view_store
    if page_view_store._conn is not None:
        page_view_store._conn.close()


def _event(session, path="/", created="2099-01-01T00:00:00+00:00"):
    return (session, path, created, "page_view", None, None, None, None, None, None, None,
            None, None, None, "Mozilla/5.0", False, None)


def _count(store):
    return store._with_connection(lambda conn: conn.execute("SELECT COUNT(*) FROM page_views").fetchone()[0])


def test_a_batch_is_written_in_one_call(store):
    store.record_page_views([_event("a"), _event("b", "/desk"), _event("c", "/pulse-board")])
    assert _count(store) == 3


def test_single_record_still_works(store):
    store.record_page_view("solo", "/", "2099-01-01T00:00:00+00:00")
    assert _count(store) == 1


def test_busy_store_is_retried_not_dropped(monkeypatch):
    calls: list[int] = []

    def flaky(events, wait=None):
        calls.append(len(events))
        if len(calls) < 3:
            raise StoreUnavailable("page_view_store: busy for over 20.0s")

    monkeypatch.setattr(activity_log.page_view_store, "record_page_views", flaky)
    monkeypatch.setattr(activity_log.time, "sleep", lambda seconds: None)
    work: queue.Queue = queue.Queue()
    for i in range(5):
        work.put((None, _event(f"s{i}")))
    activity_log._flush_page_views(work)
    # all five went out together, and the third attempt landed them
    assert calls == [5, 5, 5]
    assert work.unfinished_tasks == 0


def test_writer_waits_longer_than_request_threads():
    gate = libsql_gate.Gate("test_gate", lock_timeout=.05)
    held = threading.Event()
    release = threading.Event()

    def holder():
        with gate.hold():
            held.set()
            release.wait(2)

    thread = threading.Thread(target=holder)
    thread.start()
    held.wait(1)
    with pytest.raises(StoreUnavailable):
        with gate.hold():
            pass
    threading.Timer(.2, release.set).start()
    with gate.hold(timeout=2):  # the background writer's longer wait gets in once the reader finishes
        pass
    thread.join()
