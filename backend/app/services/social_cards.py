"""Static share metadata, generated together with each page's original artwork."""
import json
from pathlib import Path
from typing import NotRequired, TypedDict

class SocialCard(TypedDict):
    title: str
    description: str
    image: str
    alt: str
    width: NotRequired[int]
    height: NotRequired[int]


SOCIAL_CARDS: dict[str, SocialCard] = json.loads(
    (Path(__file__).resolve().parents[1] / "data" / "social_cards.json").read_text(encoding="utf-8")
)
