from sqlmodel import Session, select

from app.api.shared.crud import BaseCRUD
from app.api.tenant.models import Tenants
from app.api.tenant.schemas import TenantCreate, TenantUpdate


class TenantsCRUD(BaseCRUD[Tenants, TenantCreate, TenantUpdate]):
    def __init__(self) -> None:
        super().__init__(Tenants)

    def get_by_slug(self, session: Session, slug: str) -> Tenants | None:
        return self.get_by_field(session, "slug", slug)

    def get_by_domain(self, session: Session, domain: str) -> Tenants | None:
        """Return the active tenant for the given custom domain, or None.

        Returns None for both inactive and unknown domains to avoid
        information leakage (spec NFR2).
        """
        statement = select(Tenants).where(
            Tenants.custom_domain == domain,
            Tenants.custom_domain_active == True,  # noqa: E712
            Tenants.deleted == False,  # noqa: E712
        )
        return session.exec(statement).first()

    def resolve_by_host(
        self, session: Session, host: str, portal_domain: str
    ) -> Tenants | None:
        """Resolve a tenant from any host — custom domain or platform subdomain.

        Resolution order:
        1. Full custom domain: ``custom_domain == host`` (e.g. ``events.myclient.com``)
        2. Platform subdomain as custom domain: if ``host`` is ``X.{portal_domain}``,
           try ``custom_domain == X`` (e.g. ``de-mo`` stored as custom_domain,
           accessed via ``de-mo.dev.edgeos.world``)
        3. Platform subdomain as slug: same ``X`` looked up by ``slug``

        Returns ``None`` if no path matches.
        """
        # Normalize: strip port for all lookups — port is infrastructure, not domain identity.
        host_no_port = host.split(":")[0] if ":" in host else host

        # 1. Full custom domain lookup (e.g. events.myclient.com)
        tenant = self.get_by_domain(session, host_no_port)
        if tenant is not None:
            return tenant

        # Extract subdomain from platform host
        suffix = f".{portal_domain}"
        if not (portal_domain and host_no_port.endswith(suffix)):
            return None

        subdomain = host_no_port[: -len(suffix)].split(".")[0]
        if not subdomain:
            return None

        # 2. Subdomain as custom_domain (e.g. custom_domain="de-mo" via de-mo.dev.edgeos.world)
        tenant = self.get_by_domain(session, subdomain)
        if tenant is not None:
            return tenant

        # 3. Subdomain as slug (e.g. slug="demo" via demo.dev.edgeos.world)
        statement = select(Tenants).where(
            Tenants.slug == subdomain,
            Tenants.deleted == False,  # noqa: E712
        )
        return session.exec(statement).first()

    def create(self, session: Session, obj_in: TenantCreate) -> Tenants:
        from app.core.tenant_db import ensure_tenant_credentials

        tenant = super().create(session, obj_in)
        ensure_tenant_credentials(session, tenant.id)

        return tenant

    def soft_delete(self, session: Session, db_obj: Tenants) -> Tenants:
        from app.core.tenant_db import revoke_tenant_credentials

        revoke_tenant_credentials(session, db_obj.id)
        return super().soft_delete(session, db_obj)


tenants_crud = TenantsCRUD()
