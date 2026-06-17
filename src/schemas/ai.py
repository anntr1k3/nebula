from typing import Literal

from pydantic import BaseModel, Field, field_validator

AiAction = Literal[
    "improve",
    "shorten",
    "expand",
    "formal",
    "friendly",
    "grammar",
]

AI_ACTIONS: tuple[str, ...] = (
    "improve",
    "shorten",
    "expand",
    "formal",
    "friendly",
    "grammar",
)


class AiRewriteBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    action: AiAction = "improve"

    @field_validator("text")
    @classmethod
    def strip_text(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("Message text is required")
        return s
