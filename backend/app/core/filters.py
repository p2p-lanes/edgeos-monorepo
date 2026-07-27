"""Shared advanced-filter engine for backoffice list endpoints.

List endpoints expose a ``filters`` JSON query param carrying a filter group
(``{"match": "all"|"any", "conditions": [{"field", "op", "value"}]}``).
Each entity declares a whitelist registry of filterable fields
(field name -> kind + allowed operators). The registry is a security
boundary: unknown field names never reach SQL, and every expression is built
from SQLAlchemy column operators with bound parameters.

Entity-specific conditions (virtual fields, JSONB accessors, joined columns)
are handled through a ``condition_override`` hook; everything else maps to a
column on the entity model via the kind-based default builders below.
"""

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, ClassVar, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError, model_validator
from pydantic import Field as PydanticField
from sqlalchemy import and_, or_
from sqlmodel import col, func

TEXT_OPS = frozenset({"eq", "neq", "contains", "not_contains", "is_empty", "not_empty"})
ENUMISH_OPS = frozenset({"eq", "neq", "is_empty", "not_empty"})
DATE_OPS = frozenset({"before", "after", "is_empty", "not_empty"})
NUMERIC_OPS = frozenset({"eq", "neq", "gt", "gte", "lt", "lte"})
VALUELESS_OPS = frozenset({"is_empty", "not_empty"})

FieldKind = Literal["text", "select", "boolean", "date", "numeric", "uuid"]


@dataclass(frozen=True)
class FilterField:
    """One filterable field: value kind, allowed ops, optional value whitelist."""

    kind: FieldKind
    ops: frozenset[str]
    values: frozenset[str] | None = None  # allowed values for select kinds


class FilterCondition(BaseModel):
    """One condition of a list filter group, validated against a registry."""

    field: str
    op: str
    value: str | bool | int | float | None = None

    field_registry: ClassVar[dict[str, FilterField]] = {}

    @classmethod
    def resolve_field(cls, name: str) -> FilterField:
        """Whitelist lookup; entities override to support dynamic fields."""
        spec = cls.field_registry.get(name)
        if spec is None:
            raise ValueError(f"Filtering by '{name}' is not supported.")
        return spec

    @model_validator(mode="after")
    def validate_field_op(self) -> "FilterCondition":
        spec = self.resolve_field(self.field)
        if self.op not in spec.ops:
            raise ValueError(
                f"Operator '{self.op}' is not supported for '{self.field}'."
            )
        if self.op not in VALUELESS_OPS:
            self.validate_value(spec)
        return self

    def validate_value(self, spec: FilterField) -> None:
        """Per-kind value validation; entities override for special fields."""
        if spec.kind == "boolean":
            if not isinstance(self.value, bool):
                raise ValueError(f"Filter '{self.field}' needs true or false.")
        elif spec.kind == "date":
            if not isinstance(self.value, str):
                raise ValueError(f"Invalid date for '{self.field}'.")
            try:
                date.fromisoformat(self.value)
            except ValueError:
                raise ValueError(f"Invalid date for '{self.field}'.") from None
        elif spec.kind == "numeric":
            if self.value is None or isinstance(self.value, bool):
                raise ValueError(f"Invalid number for '{self.field}'.")
            try:
                parsed = Decimal(str(self.value))
            except InvalidOperation:
                raise ValueError(f"Invalid number for '{self.field}'.") from None
            if not parsed.is_finite():
                raise ValueError(f"Invalid number for '{self.field}'.")
        elif spec.kind == "uuid":
            if not isinstance(self.value, str):
                raise ValueError(f"Invalid value for '{self.field}'.")
            try:
                uuid.UUID(self.value)
            except ValueError:
                raise ValueError(f"Invalid value for '{self.field}'.") from None
        else:  # text / select
            if not isinstance(self.value, str):
                raise ValueError(f"Invalid value for '{self.field}'.")
            if spec.values is not None and self.value not in spec.values:
                raise ValueError(f"Invalid value for '{self.field}'.")

    @property
    def date_value(self) -> date:
        """Parsed ISO date value for before/after conditions."""
        return date.fromisoformat(str(self.value))

    @property
    def uuid_value(self) -> uuid.UUID:
        """Parsed UUID value for uuid-kind conditions."""
        return uuid.UUID(str(self.value))

    @property
    def decimal_value(self) -> Decimal:
        """Parsed Decimal value for numeric conditions."""
        return Decimal(str(self.value))


class FilterGroup(BaseModel):
    """Filter group for a BO list; ``match`` combines with AND/OR."""

    match: Literal["all", "any"] = "all"
    conditions: list[FilterCondition] = PydanticField(default_factory=list)


def parse_filters[FiltersT: FilterGroup](
    raw: str | None, model: type[FiltersT]
) -> FiltersT | None:
    """Parse a ``filters`` query param JSON into the entity's filter model.

    Raises HTTPException 422 with a user-oriented message when the JSON is
    malformed or a condition uses an unsupported field, operator, or value.
    """
    if raw is None:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422, detail="Filters are not valid. Please check them."
        ) from None
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        message = str(first.get("msg", "")).removeprefix("Value error, ").strip()
        if not message or first.get("type") != "value_error":
            message = "Filters are not valid. Please check them."
        raise HTTPException(status_code=422, detail=message) from None


def escape_like(value: str) -> str:
    """Escape LIKE wildcards so user input matches literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def text_condition_expression(column: Any, op: str, value: Any) -> Any:
    """Boolean expression for a nullable text column.

    eq is exact; contains is case-insensitive; negative ops (neq,
    not_contains) also match NULL/missing values; is_empty means NULL or "".
    """
    if op == "eq":
        return column == value
    if op == "neq":
        return or_(column.is_(None), column != value)
    if op == "contains":
        return column.ilike(f"%{escape_like(str(value))}%", escape="\\")
    if op == "not_contains":
        return or_(
            column.is_(None),
            ~column.ilike(f"%{escape_like(str(value))}%", escape="\\"),
        )
    if op == "is_empty":
        return or_(column.is_(None), column == "")
    return and_(column.is_not(None), column != "")


def date_condition_expression(column: Any, op: str, value: date | None) -> Any:
    """Boolean expression for a datetime column compared by calendar date."""
    if op == "before":
        return func.date(column) < value
    if op == "after":
        return func.date(column) > value
    if op == "is_empty":
        return column.is_(None)
    return column.is_not(None)


def numeric_condition_expression(column: Any, op: str, value: Decimal | None) -> Any:
    """Boolean expression for a numeric column; neq also matches NULL."""
    if op == "eq":
        return column == value
    if op == "neq":
        return or_(column.is_(None), column != value)
    if op == "gt":
        return column > value
    if op == "gte":
        return column >= value
    if op == "lt":
        return column < value
    if op == "lte":
        return column <= value
    if op == "is_empty":
        return column.is_(None)
    return column.is_not(None)


def uuid_condition_expression(column: Any, op: str, value: uuid.UUID | None) -> Any:
    """Boolean expression for a UUID column; neq also matches NULL."""
    if op == "eq":
        return column == value
    if op == "neq":
        return or_(column.is_(None), column != value)
    if op == "is_empty":
        return column.is_(None)
    return column.is_not(None)


def default_condition_expression(
    column: Any, spec: FilterField, condition: FilterCondition
) -> Any:
    """Kind-based routing of one condition to its SQL builder."""
    valueless = condition.op in VALUELESS_OPS
    if spec.kind == "date":
        return date_condition_expression(
            column, condition.op, None if valueless else condition.date_value
        )
    if spec.kind == "numeric":
        return numeric_condition_expression(
            column, condition.op, None if valueless else condition.decimal_value
        )
    if spec.kind == "uuid":
        return uuid_condition_expression(
            column, condition.op, None if valueless else condition.uuid_value
        )
    if spec.kind == "boolean":
        return column == condition.value
    return text_condition_expression(column, condition.op, condition.value)


ConditionOverride = Callable[[FilterCondition], Any]


def build_filter_expression(
    filters: FilterGroup,
    model: type,
    condition_override: ConditionOverride | None = None,
) -> Any:
    """Combine a filter group into one boolean expression (None when empty).

    ``condition_override`` handles entity-specific conditions (virtual
    fields, JSONB accessors, joined columns); returning None delegates the
    condition to the default column mapping on ``model``.
    """
    expressions = []
    for condition in filters.conditions:
        expression = condition_override(condition) if condition_override else None
        if expression is None:
            spec = type(condition).resolve_field(condition.field)
            column = col(getattr(model, condition.field))
            expression = default_condition_expression(column, spec, condition)
        expressions.append(expression)
    if not expressions:
        return None
    if filters.match == "any":
        return or_(*expressions)
    return and_(*expressions)
