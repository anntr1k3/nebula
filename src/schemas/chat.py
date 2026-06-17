"""Pydantic-модели для тел запросов chat_api.

Сохраняются точные английские строки ошибок, чтобы фронтовая
`translateApiMessage` (static/js/i18n.js → API_MESSAGE_KEYS) находила их по ключу.
"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class BlockBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    username: str = ""
    block_username: str = ""

    @model_validator(mode="after")
    def _check_required(self) -> "BlockBody":
        if not self.username or not self.block_username:
            raise ValueError("Missing required fields")
        return self


class UnblockBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    username: str = ""
    unblock_username: str = ""

    @model_validator(mode="after")
    def _check_required(self) -> "UnblockBody":
        if not self.username or not self.unblock_username:
            raise ValueError("Missing required fields")
        return self


class CreateRoomBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = ""
    creator: str = ""
    members: list[str] = Field(default_factory=list)

    @field_validator("members", mode="before")
    @classmethod
    def _coerce_members(cls, v: object) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(m) for m in v if m]
        return []

    @model_validator(mode="after")
    def _check_required(self) -> "CreateRoomBody":
        if not self.name or not self.members:
            raise ValueError("Fill in all fields")
        return self


class ScheduleMessageBody(BaseModel):
    """POST /api/messages/schedule — тело запроса.

    Поле `username` сохранено, т.к. роут сверяет его с текущим пользователем
    и при несовпадении отдаёт 403 Access denied.
    """

    model_config = ConfigDict(extra="ignore")

    username: str | None = None
    room_id: str = ""
    text: str = ""
    scheduled_at: datetime | None = None
    media_type: str | None = None
    media_path: str | None = None
    media_name: str | None = None
    media_meta: Any | None = None
    reply_to: Any | None = None

    @field_validator("scheduled_at", mode="before")
    @classmethod
    def _parse_scheduled_at(cls, v: object) -> datetime | None:
        if v is None or v == "":
            return None
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except (ValueError, TypeError) as exc:
                raise ValueError("Bad datetime") from exc
        raise ValueError("Bad datetime")

    @model_validator(mode="after")
    def _check_required_and_future(self) -> "ScheduleMessageBody":
        if not self.room_id or self.scheduled_at is None:
            raise ValueError("Invalid request")

        sched = self.scheduled_at
        if sched.tzinfo is not None:
            sched = sched.astimezone(UTC).replace(tzinfo=None)
            self.scheduled_at = sched

        if sched <= datetime.utcnow():
            raise ValueError("Time must be in the future")
        return self


class UpdateScheduledMessageBody(BaseModel):
    """PATCH /api/messages/scheduled/<id>"""

    model_config = ConfigDict(extra="ignore")

    text: str | None = None
    scheduled_at: datetime | None = None

    @field_validator("scheduled_at", mode="before")
    @classmethod
    def _parse_scheduled_at(cls, v: object) -> datetime | None:
        if v is None or v == "":
            return None
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except (ValueError, TypeError) as exc:
                raise ValueError("Bad datetime") from exc
        raise ValueError("Bad datetime")

    @model_validator(mode="after")
    def _check_update(self) -> "UpdateScheduledMessageBody":
        if self.text is None and self.scheduled_at is None:
            raise ValueError("Nothing to update")
        if self.scheduled_at is not None:
            sched = self.scheduled_at
            if sched.tzinfo is not None:
                sched = sched.astimezone(UTC).replace(tzinfo=None)
                self.scheduled_at = sched
            if sched <= datetime.utcnow():
                raise ValueError("Time must be in the future")
        if self.text is not None and not str(self.text).strip():
            raise ValueError("Message cannot be empty")
        return self
