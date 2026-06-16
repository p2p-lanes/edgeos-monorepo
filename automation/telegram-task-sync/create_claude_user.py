#!/usr/bin/env python3
"""Idempotently create the "Claude" service superadmin used by the routine.

Tasks created by the routine are attributed to this user, so they show up in the
backoffice as "Created by: Claude" (the API resolves created_by_name from
users.full_name — see backend/app/api/task/crud.py).

The email uses a plus-alias of the operator's real inbox
(ignacio+claude@muvinai.com) so the OTP login code is delivered to
ignacio@muvinai.com, where the routine's Gmail connector can read it. The alias
is a distinct user row (the unique key is (email, tenant_id) where deleted=false).

Run this ONCE against the target database. It reuses the backend's engine and
models, so it must run with the backend's environment (DATABASE settings) loaded:

    cd backend
    python ../automation/telegram-task-sync/create_claude_user.py

Override the defaults with env vars if needed:
    CLAUDE_USER_EMAIL (default ignacio+claude@muvinai.com)
    CLAUDE_USER_NAME  (default Claude)

Equivalent raw SQL (if you prefer running it directly against the DB):

    INSERT INTO users (id, email, full_name, role, tenant_id, deleted, auth_attempts)
    SELECT gen_random_uuid(), 'ignacio+claude@muvinai.com', 'Claude',
           'superadmin', NULL, false, 0
    WHERE NOT EXISTS (
        SELECT 1 FROM users WHERE email = 'ignacio+claude@muvinai.com'
    );
"""

import os
import sys
from pathlib import Path

# Make the backend package importable whether or not cwd is backend/.
BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session, select  # noqa: E402

from app.api.shared.enums import UserRole  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import Users  # noqa: E402

EMAIL = os.environ.get("CLAUDE_USER_EMAIL", "ignacio+claude@muvinai.com")
FULL_NAME = os.environ.get("CLAUDE_USER_NAME", "Claude")


def main() -> None:
    with Session(engine) as session:
        existing = session.exec(select(Users).where(Users.email == EMAIL)).first()
        if existing:
            print(
                f"Claude user already exists: id={existing.id} "
                f"email={existing.email} role={existing.role}"
            )
            return

        user = Users(
            email=EMAIL,
            full_name=FULL_NAME,
            role=UserRole.SUPERADMIN,
            tenant_id=None,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        print(f"Claude user created: id={user.id} email={user.email} (superadmin)")


if __name__ == "__main__":
    main()
