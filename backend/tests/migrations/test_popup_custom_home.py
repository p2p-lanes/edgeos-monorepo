"""The original popup custom-home migration remains in the revision chain."""

from alembic.config import Config
from alembic.script import ScriptDirectory

REVISION = "d9e4c2a7b6f1"
PREVIOUS_REVISION = "a4f1c8b2e7d3"
RESOURCE_REVISION = "e2c6a91b7d4f"
RESOURCE_PREVIOUS_REVISION = "a7c9e2f4b6d8"


def test_custom_home_migration_precedes_the_dedicated_resource():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [RESOURCE_REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION
    assert (
        script.get_revision(RESOURCE_REVISION).down_revision
        == RESOURCE_PREVIOUS_REVISION
    )
