"""Generic snapshot + diff machinery for the audit log.

Any resource can be audited by snapshotting the fields of its *Update schema and
diffing before/after — there is no per-resource snapshot/diff code to duplicate.
A resource module supplies only its update schema, optional FK→name enrichment,
and the entity metadata (type / id / label / popup). See
``app.api.event_audit.crud`` for the canonical example.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel


def jsonable(value: Any) -> Any:
    """Coerce a value to something JSON/JSONB-serializable and diff-stable.

    Recurses into lists/tuples and dicts so collections of UUIDs/datetimes/enums
    are coerced element-wise — e.g. ``collaborator_ids`` (a ``list[UUID]``) would
    otherwise reach the JSONB column as raw UUID objects and raise
    "Object of type UUID is not JSON serializable" on flush.
    """
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, dict):
        return {key: jsonable(val) for key, val in value.items()}
    return value


def fields_from_update_schema(schema_cls: type[BaseModel]) -> tuple[str, ...]:
    """Every editable field of a resource's *Update Pydantic schema.

    Deriving from the schema means new editable fields are audited automatically
    — no hand-maintained list to drift out of sync with what can be edited.
    """
    return tuple(schema_cls.model_fields.keys())


def build_snapshot(obj: Any, fields: Iterable[str]) -> dict[str, Any]:
    """Snapshot ``fields`` off ``obj`` (missing attributes resolve to None)."""
    return {field: jsonable(getattr(obj, field, None)) for field in fields}


def compute_changes(
    before: dict[str, Any], after: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Diff two snapshots → ``{field: {"old": ..., "new": ...}}`` (changed only)."""
    changes: dict[str, dict[str, Any]] = {}
    for key in before.keys() | after.keys():
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"old": old, "new": new}
    return changes


def change_details(
    snapshot: dict[str, Any] | None, changes: dict[str, Any] | None
) -> dict[str, Any] | None:
    """The standard `details` JSONB shape for a resource change.

    ``{"snapshot": <after-state>, "changes": {field: {old, new}}}`` — the shape
    the backoffice activity feed knows how to render for any resource.
    """
    details: dict[str, Any] = {}
    if snapshot is not None:
        details["snapshot"] = snapshot
    if changes:
        details["changes"] = changes
    return details or None
