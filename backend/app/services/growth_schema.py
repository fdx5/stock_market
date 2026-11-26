"""Tables of the 100x growth control room (services/growth_control.py).

Additive only. Every table here is created IF NOT EXISTS and is written with plain
INSERT / INSERT OR IGNORE — no row is ever updated, replaced or deleted. A day's
metrics are keyed by (day, version): when the definition of a metric changes, the
new definition gets a new version number and the old rows stay as they were.
"""

SCHEMAS = (
    """
    CREATE TABLE IF NOT EXISTS growth_day_metrics (
        day TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (day, version)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS growth_goal_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        baseline_daily REAL NOT NULL,
        baseline_method TEXT NOT NULL,
        baseline_from TEXT,
        baseline_to TEXT,
        target_multiplier INTEGER NOT NULL DEFAULT 100,
        target_date TEXT,
        note TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS growth_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        day TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        focus_channel TEXT,
        focus_path TEXT
    )
    """,
    # Interim targets of a goal version ("20x by 11-30" before "100x by 12-31"). Append-only.
    """
    CREATE TABLE IF NOT EXISTS growth_goal_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        multiplier REAL NOT NULL,
        target_date TEXT NOT NULL
    )
    """,
    # '지금 할 일' completion marks. Append-only: the newest row per key is its state
    # ('done' or 'open' when reopened); nothing is updated or deleted.
    """
    CREATE TABLE IF NOT EXISTS growth_insight_marks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        insight_key TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        note TEXT
    )
    """,
)
