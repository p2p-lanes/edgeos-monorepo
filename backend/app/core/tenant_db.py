import secrets
import uuid
from dataclasses import dataclass

from loguru import logger
from pydantic import PostgresDsn
from sqlalchemy import Engine, event, text
from sqlmodel import Session, create_engine, select

from app.api.shared.enums import CredentialType
from app.core.config import settings
from app.utils.encryption import decrypt, encrypt

CREDENTIAL_TYPE_ROLES = {
    CredentialType.CRUD: "tenant_role",
    CredentialType.READONLY: "tenant_viewer_role",
}


@dataclass(frozen=True)
class CachedCredential:
    username: str
    password: str


class TenantConnectionManager:
    _instance: "TenantConnectionManager | None" = None
    _engines: dict[tuple[uuid.UUID, CredentialType], Engine]
    _credentials: dict[tuple[uuid.UUID, CredentialType], CachedCredential]

    def __new__(cls) -> "TenantConnectionManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._engines = {}
            cls._instance._credentials = {}
        return cls._instance

    def get_credential(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        credential_type: CredentialType,
    ) -> CachedCredential | None:
        """Get credential from cache or database. Returns None if not found."""
        from app.api.tenant.credential_models import TenantCredentials

        cache_key = (tenant_id, credential_type)
        if cache_key in self._credentials:
            return self._credentials[cache_key]

        # Not in cache - fetch from database
        credential = session.exec(
            select(TenantCredentials).where(
                TenantCredentials.tenant_id == tenant_id,
                TenantCredentials.credential_type == credential_type,
            )
        ).first()

        if not credential:
            return None

        cached = CachedCredential(
            username=credential.db_username,
            password=decrypt(credential.db_password_encrypted),
        )
        self._credentials[cache_key] = cached
        logger.debug(
            f"Cached {credential_type.value} credential for tenant {tenant_id}"
        )
        return cached

    def invalidate_credential(
        self, tenant_id: uuid.UUID, credential_type: CredentialType | None = None
    ) -> None:
        """Remove credential from cache (call when credentials change)."""
        if credential_type is not None:
            cache_key = (tenant_id, credential_type)
            self._credentials.pop(cache_key, None)
        else:
            for cred_type in CredentialType:
                self._credentials.pop((tenant_id, cred_type), None)

    def get_engine(
        self,
        tenant_id: uuid.UUID,
        credential_type: CredentialType,
        db_username: str,
        db_password: str,
    ) -> Engine:
        cache_key = (tenant_id, credential_type)
        if cache_key not in self._engines:
            connection_string = self._build_connection_string(db_username, db_password)
            engine = create_engine(
                connection_string,
                pool_size=5,
                max_overflow=10,  # Allow burst connections beyond pool_size
                pool_pre_ping=True,
                pool_recycle=3600,  # Recycle connections after 1 hour
                pool_timeout=30,  # Wait max 30s for a connection from pool
            )

            @event.listens_for(engine, "checkout")
            def set_tenant_context(
                dbapi_connection,
                connection_record,  # noqa: ARG001
                connection_proxy,  # noqa: ARG001
            ):
                cursor = dbapi_connection.cursor()
                cursor.execute(f"SET app.tenant_id = '{tenant_id}'")
                cursor.close()

            self._engines[cache_key] = engine
            logger.info(
                f"Created {credential_type.value} database engine for tenant {tenant_id}"
            )

        return self._engines[cache_key]

    def remove_engine(
        self, tenant_id: uuid.UUID, credential_type: CredentialType | None = None
    ) -> None:
        if credential_type is not None:
            cache_key = (tenant_id, credential_type)
            if cache_key in self._engines:
                self._engines[cache_key].dispose()
                del self._engines[cache_key]
                logger.info(
                    f"Removed {credential_type.value} database engine for tenant {tenant_id}"
                )
        else:
            for cred_type in CredentialType:
                cache_key = (tenant_id, cred_type)
                if cache_key in self._engines:
                    self._engines[cache_key].dispose()
                    del self._engines[cache_key]
            logger.info(f"Removed all database engines for tenant {tenant_id}")
        # Also invalidate cached credentials
        self.invalidate_credential(tenant_id, credential_type)

    def _build_connection_string(self, username: str, password: str) -> str:
        from urllib.parse import quote

        dsn = PostgresDsn.build(
            scheme="postgresql+psycopg",
            username=username,
            password=quote(password, safe=""),
            host=settings.POSTGRES_SERVER,
            port=settings.POSTGRES_PORT,
            path=settings.POSTGRES_DB,
            query=f"sslmode={settings.POSTGRES_SSL_MODE}",
        )
        return str(dsn)


tenant_connection_manager = TenantConnectionManager()


def generate_db_username() -> str:
    return f"usr_{secrets.token_hex(8)}"


def create_tenant_db_user(
    session: Session,
    username: str,
    password: str,
    credential_type: CredentialType,
) -> None:
    role = CREDENTIAL_TYPE_ROLES[credential_type]
    escaped_password = password.replace("'", "''")
    session.exec(text(f"CREATE USER {username} WITH PASSWORD '{escaped_password}'"))
    session.exec(text(f"GRANT {role} TO {username}"))
    session.commit()

    logger.info(f"Created PostgreSQL user {username} with role {role}")


def drop_tenant_db_user(session: Session, username: str) -> None:
    session.exec(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE usename = :username
            """
        ).bindparams(username=username)
    )

    for role in CREDENTIAL_TYPE_ROLES.values():
        session.exec(text(f"REVOKE {role} FROM {username}"))

    session.exec(text(f"DROP USER IF EXISTS {username}"))
    session.commit()

    logger.info(f"Dropped PostgreSQL user {username}")


def ensure_tenant_credentials(session: Session, tenant_id: uuid.UUID) -> None:
    from app.api.tenant.credential_models import TenantCredentials

    for credential_type in CredentialType:
        existing = session.exec(
            select(TenantCredentials).where(
                TenantCredentials.tenant_id == tenant_id,
                TenantCredentials.credential_type == credential_type,
            )
        ).first()

        if existing:
            continue

        password = secrets.token_urlsafe(32)
        username = generate_db_username()

        create_tenant_db_user(session, username, password, credential_type)

        credential = TenantCredentials(
            tenant_id=tenant_id,
            credential_type=credential_type,
            db_username=username,
            db_password_encrypted=encrypt(password),
        )
        session.add(credential)
        session.commit()

        logger.info(
            f"Created {credential_type.value} credentials for tenant {tenant_id}"
        )


def revoke_tenant_credentials(session: Session, tenant_id: uuid.UUID) -> bool:
    from app.api.tenant.credential_models import TenantCredentials

    credentials = session.exec(
        select(TenantCredentials).where(TenantCredentials.tenant_id == tenant_id)
    ).all()

    if not credentials:
        return False

    for credential in credentials:
        drop_tenant_db_user(session, credential.db_username)
        session.delete(credential)

    tenant_connection_manager.remove_engine(tenant_id)

    session.commit()

    # Check if roles are still in use, drop if not
    for role in CREDENTIAL_TYPE_ROLES.values():
        # Check if any other users have this role granted
        result = session.exec(
            text(
                """
                SELECT COUNT(*)
                FROM pg_auth_members m
                JOIN pg_roles r ON m.roleid = r.oid
                WHERE r.rolname = :role
                """
            ).bindparams(role=role)
        ).scalar()

        if result == 0:
            session.exec(text(f"DROP ROLE IF EXISTS {role}"))
            logger.info(f"Dropped PostgreSQL role {role} (no longer in use)")

    session.commit()

    logger.info(f"Revoked all credentials for tenant {tenant_id}")
    return True


def get_tenant_credential(
    session: Session, tenant_id: uuid.UUID, credential_type: CredentialType
) -> tuple[str, str] | None:
    from app.api.tenant.credential_models import TenantCredentials

    credential = session.exec(
        select(TenantCredentials).where(
            TenantCredentials.tenant_id == tenant_id,
            TenantCredentials.credential_type == credential_type,
        )
    ).first()

    if not credential:
        return None

    return credential.db_username, decrypt(credential.db_password_encrypted)
