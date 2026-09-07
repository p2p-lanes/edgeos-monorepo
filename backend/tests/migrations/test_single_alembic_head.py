from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

MERGE_HEAD = "a6f4c2e9d1b7"


def test_repository_has_one_alembic_head() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "app" / "alembic"))

    assert ScriptDirectory.from_config(config).get_heads() == [MERGE_HEAD]
