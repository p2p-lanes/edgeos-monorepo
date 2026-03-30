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
        1. Custom domain: ``custom_domain == host AND custom_domain_active AND NOT deleted``
        2. Platform subdomain: if ``host`` ends with ``.{portal_domain}``, extract the
           leftmost label as slug and look up by ``slug AND NOT deleted``.

        Returns ``None`` if neither path matches.
        """
        # Normalize: strip port for all lookups — port is infrastructure, not domain identity.
        host_no_port = host.split(":")[0] if ":" in host else host

        # 1. Custom domain lookup
        tenant = self.get_by_domain(session, host_no_port)
        if tenant is not None:
            return tenant

        # 2. Platform subdomain fallback
        suffix = f".{portal_domain}"
        if portal_domain and host_no_port.endswith(suffix):
            slug = host_no_port[: -len(suffix)].split(".")[0]
            if slug:
                statement = select(Tenants).where(
                    Tenants.slug == slug,
                    Tenants.deleted == False,  # noqa: E712
                )
                return session.exec(statement).first()

        return None

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
