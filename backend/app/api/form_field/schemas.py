import uuid
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlmodel import Column, Field, SQLModel


class FormFieldType(str, Enum):
    TEXT = "text"
    TEXTAREA = "textarea"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    SELECT_CARDS = "select_cards"
    MULTISELECT = "multiselect"
    MULTISELECT_DETAILED = "multiselect_detailed"
    RADIO = "radio"
    DATE = "date"
    EMAIL = "email"
    URL = "url"
    PHONE = "phone"
    RICH_TEXT = "rich_text"
    IMAGE_UPLOAD = "image_upload"
    COUNTRY_SELECT = "country_select"
    SIGNATURE = "signature"


class FormFieldBase(SQLModel):
    """Persisted form field. `config` is a per-type bag with shapes:

    - rich_text:           { content, is_checkbox }
    - image_upload:        { button_text }
    - country_select:      {}
    - signature:            { pdf_url, require_date }
    - radio:               {}  (uses `options` only, like select)
    - multiselect_detailed: { subtitles: { [title]: subtitle },
                              min_selections?: int,
                              max_selections?: int }

    `width` overrides the frontend's type-based heuristic when set
    ("full" spans both columns, "half" stays single-column). NULL falls back
    to the heuristic.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    name: str = Field(index=True)
    label: str
    field_type: str = Field(default=FormFieldType.TEXT.value)
    section_id: uuid.UUID | None = Field(
        default=None, nullable=True, foreign_key="formsections.id"
    )
    position: int = Field(default=0)
    required: bool = Field(default=False)
    options: list[str] | None = Field(
        default=None, sa_column=Column(ARRAY(String), nullable=True)
    )
    placeholder: str | None = Field(default=None, nullable=True)
    help_text: str | None = Field(default=None, nullable=True)
    min_date: str | None = Field(default=None, nullable=True)
    max_date: str | None = Field(default=None, nullable=True)
    # MutableDict tracks in-place mutations so SQLAlchemy emits an UPDATE
    # even when a nested key changes without reassigning the dict.
    config: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(MutableDict.as_mutable(JSONB), nullable=True),
    )
    # Stored as plain str so SQLModel can map it; values are validated as
    # Literal["full", "half"] | None on the API layer (FormFieldPublic /
    # FormFieldCreate / FormFieldUpdate).
    width: str | None = Field(default=None, nullable=True)


class FormFieldPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    name: str
    label: str
    field_type: str
    section_id: uuid.UUID | None = None
    section_label: str | None = None
    position: int = 0
    required: bool = False
    options: list[str] | None = None
    placeholder: str | None = None
    help_text: str | None = None
    min_date: str | None = None
    max_date: str | None = None
    config: dict[str, Any] | None = None
    width: Literal["full", "half"] | None = None
    protected: bool = False
    removable: bool = True
    target: str | None = None

    model_config = ConfigDict(from_attributes=True)


class FormFieldCreate(BaseModel):
    popup_id: uuid.UUID
    label: str
    field_type: str = FormFieldType.TEXT.value
    section_id: uuid.UUID | None = None
    position: int = 0
    required: bool = False
    options: list[str] | None = None
    placeholder: str | None = None
    help_text: str | None = None
    min_date: str | None = None
    max_date: str | None = None
    config: dict[str, Any] | None = None
    width: Literal["full", "half"] | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class FormFieldUpdate(BaseModel):
    label: str | None = None
    field_type: str | None = None
    section_id: uuid.UUID | None = None
    position: int | None = None
    required: bool | None = None
    options: list[str] | None = None
    placeholder: str | None = None
    help_text: str | None = None
    min_date: str | None = None
    max_date: str | None = None
    config: dict[str, Any] | None = None
    width: Literal["full", "half"] | None = None
