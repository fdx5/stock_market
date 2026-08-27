from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Literal

from app.services.translation import translate_batch_to_english, translate_batch_to_korean

router = APIRouter()


class TranslateRequest(BaseModel):
    # Bounded to accommodate the KOSPI MAP's full 500-name snapshot in one request.
    texts: list[str] = Field(..., max_length=600)
    target_lang: Literal["en", "ko"] = "en"


@router.post("/translate")
def translate(payload: TranslateRequest):
    translator = translate_batch_to_korean if payload.target_lang == "ko" else translate_batch_to_english
    return {"translations": translator(payload.texts)}
