"""Unit tests for ``app.api.audit_log.snapshot.jsonable``.

Regression guard: a ``list[UUID]`` field (e.g. ``Events.collaborator_ids``) must
be coerced element-wise to strings, otherwise the raw UUID objects reach the
JSONB audit column and raise "Object of type UUID is not JSON serializable" on
flush (seen in production when deleting an event with collaborators).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from enum import Enum

from app.api.audit_log.snapshot import jsonable


class _Color(str, Enum):
    RED = "red"


def test_scalar_uuid_becomes_string() -> None:
    u = uuid.uuid4()
    assert jsonable(u) == str(u)


def test_list_of_uuids_is_coerced_elementwise() -> None:
    ids = [uuid.uuid4(), uuid.uuid4()]
    out = jsonable(ids)
    assert out == [str(ids[0]), str(ids[1])]
    # The whole point: the result is now JSON-serializable.
    json.dumps(out)


def test_tuple_is_coerced_to_list() -> None:
    ids = (uuid.uuid4(),)
    out = jsonable(ids)
    assert out == [str(ids[0])]


def test_nested_dict_and_list_are_coerced() -> None:
    u = uuid.uuid4()
    dt = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
    value = {"ids": [u], "when": dt, "color": _Color.RED}
    out = jsonable(value)
    assert out == {"ids": [str(u)], "when": dt.isoformat(), "color": "red"}
    json.dumps(out)


def test_plain_values_pass_through() -> None:
    assert jsonable("x") == "x"
    assert jsonable(7) == 7
    assert jsonable(None) is None
    assert jsonable(["a", "b"]) == ["a", "b"]
