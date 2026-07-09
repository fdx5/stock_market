from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.translation import translate_batch_to_english

router = APIRouter()


class TranslateRequest(BaseModel):
    # Bounded to accommodate the KOSPI MAP's full 500-name snapshot in one request.
    texts: list[str] = Field(..., max_length=600)


@router.post("/translate")
def translate(payload: TranslateRequest):
    return {"translations": translate_batch_to_english(payload.texts)}
