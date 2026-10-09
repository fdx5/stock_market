"""Migration regression with artificial Python records only; never import the app or a DB."""
import ast
import datetime
import threading
import unittest
from pathlib import Path


class ArtificialConnection:
    def __init__(self, tables):
        self.tables = tables
        self.statements = []

    def execute(self, sql, args=()):
        self.statements.append(sql)
        words = sql.upper()
        if any(token in words for token in ("DELETE", "REPLACE", "UPDATE", "DROP", "TRUNCATE")):
            raise AssertionError("destructive SQL is prohibited")
        rows = []
        if sql.startswith("SELECT value FROM re_meta"):
            rows = [(self.tables["meta"],)] if self.tables.get("meta") else []
        elif sql.startswith("SELECT rowid"):
            rows = [row for row in self.tables.get(sql.split(" FROM ")[1].split()[0], []) if row[0] > args[0]][:args[1]]
        elif sql.startswith("INSERT OR IGNORE INTO re_meta"):
            self.tables.setdefault("meta", args[0])
        return type("ArtificialCursor", (), {"fetchall": lambda _: rows})()

    def executemany(self, sql, rows):
        self.statements.append(sql)
        if not sql.startswith("INSERT OR IGNORE INTO"):
            raise AssertionError("only additive copies are allowed")
        table = sql.split()[4]
        existing = self.tables.setdefault(table, [])
        for row in rows:
            if not any(current[0] == row[0] for current in existing):
                existing.append(tuple(row))

    def commit(self):
        pass


class MigrationPreservation(unittest.TestCase):
    def scope(self, completed=False):
        path = Path(__file__).resolve().parents[1] / "app/services/realestate_store.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_migrate_once")
        target = ArtificialConnection({"re_map_cache": [("map-key", "saved-data")], "re_trade_months": [("existing", "saved-value")]})
        if completed:
            target.tables["meta"] = "original-completion-marker"
        source = ArtificialConnection({"re_trade_months": [(1, "existing", "different-value"), (2, "new", "new-value")]})
        scope = {"_dt": datetime, "TURSO_DATABASE_URL": "target", "TURSO_AUTH_TOKEN": None,
                 "SHARED_DATABASE_URL": "source", "SHARED_AUTH_TOKEN": None,
                 "_SCHEMA": "CREATE TABLE IF NOT EXISTS example", "_FACTS_SCHEMA": "", "_MAP_SCHEMA": "", "_RENT_SCHEMA": "", "_META_SCHEMA": "",
                 "_MOVE": [("re_trade_months", "key, value", 40)], "_moved_upto": {}, "migration_state": {"rows": 0},
                 "migrated": threading.Event(), "_retry": lambda fn: fn(),
                 "_open": lambda url, token: target if url == "target" else source}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), "exec"), scope)
        return scope, target

    def test_copy_keeps_existing_cache_and_rows(self):
        scope, target = self.scope()
        scope["_migrate_once"]()
        self.assertEqual(target.tables["re_map_cache"], [("map-key", "saved-data")])
        self.assertEqual(target.tables["re_trade_months"], [("existing", "saved-value"), ("new", "new-value")])
        self.assertTrue(scope["migrated"].is_set())
        self.assertIsNone(scope["migration_state"]["error"])

    def test_completed_copy_preserves_marker_and_all_rows(self):
        scope, target = self.scope(completed=True)
        scope["_migrate_once"]()
        self.assertEqual(target.tables["meta"], "original-completion-marker")
        self.assertEqual(target.tables["re_map_cache"], [("map-key", "saved-data")])
        self.assertEqual(target.tables["re_trade_months"], [("existing", "saved-value")])
        self.assertFalse(any(sql.startswith("INSERT") for sql in target.statements))
        self.assertTrue(scope["migrated"].is_set())


if __name__ == "__main__":
    unittest.main()
