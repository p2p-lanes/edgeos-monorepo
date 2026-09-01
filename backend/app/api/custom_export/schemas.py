import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ExportFormat(StrEnum):
    CSV = "csv"
    XLSX = "xlsx"


class ExportColumn(BaseModel):
    field: str = Field(min_length=1, max_length=120)
    label: str | None = Field(default=None, min_length=1, max_length=120)


class ExportFilter(BaseModel):
    field: str = Field(min_length=1, max_length=120)
    operator: Literal[
        "eq",
        "neq",
        "contains",
        "not_contains",
        "in",
        "is_empty",
        "not_empty",
        "gt",
        "gte",
        "lt",
        "lte",
        "before",
        "after",
    ]
    value: Any = None


class CustomExportSpec(BaseModel):
    dataset: str = Field(min_length=1, max_length=80)
    popup_id: uuid.UUID | None = None
    columns: list[ExportColumn] = Field(min_length=1, max_length=25)
    filters: list[ExportFilter] = Field(default_factory=list, max_length=20)
    format: ExportFormat = ExportFormat.CSV
    filename: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("filename")
    @classmethod
    def normalize_filename(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = "".join(
            character
            for character in value.strip()
            if character.isalnum() or character in {"-", "_", " "}
        ).strip()
        return normalized or None


class ExportDownloadRequest(BaseModel):
    spec: CustomExportSpec
    fingerprint: str = Field(min_length=12, max_length=64)


class ExportFieldPublic(BaseModel):
    field: str
    label: str
    type: str
    sensitivity: str
    filter_operators: list[str]


class ExportDatasetPublic(BaseModel):
    dataset: str
    label: str
    description: str
    scope: Literal["organization", "gathering"]
    row_label: str
    fields: list[ExportFieldPublic]


class ExportCatalogPublic(BaseModel):
    datasets: list[ExportDatasetPublic]
    formats: list[ExportFormat]
    limits: dict[str, int]


class ExportPreviewColumn(BaseModel):
    field: str
    label: str
    type: str
    sensitivity: str


class ExportPreview(BaseModel):
    title: str
    dataset: str
    dataset_label: str
    scope: Literal["organization", "gathering"]
    row_label: str
    estimated_rows: int
    columns: list[ExportPreviewColumn]
    filters: list[ExportFilter]
    warnings: list[str]
    format: ExportFormat
    filename: str
    spec: CustomExportSpec
    fingerprint: str
    generated_at: datetime
