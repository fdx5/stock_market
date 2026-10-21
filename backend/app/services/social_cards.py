"""Static share metadata, generated together with each page's original artwork."""
import json
from pathlib import Path

SOCIAL_CARDS: dict[str, dict[str, str]] = json.loads(
    (Path(__file__).resolve().parents[1] / "data" / "social_cards.json").read_text(encoding="utf-8")
)
