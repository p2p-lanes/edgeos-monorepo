import uuid

from sqlmodel import Session, func, select

from app.api.email_template.models import EmailTemplates
from app.api.email_template.schemas import EmailTemplateCreate, EmailTemplateUpdate
from app.api.shared.crud import BaseCRUD


class EmailTemplateCRUD(
    BaseCRUD[EmailTemplates, EmailTemplateCreate, EmailTemplateUpdate]
):
    def __init__(self) -> None:
        super().__init__(EmailTemplates)

    def get_by_popup_and_type(
        self, session: Session, popup_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        """Popup-shared tier only (`sales_flow_id IS NULL`) — a flow-scoped
        row of the same type lives in a disjoint tier (sdd/sales-flows
        slice 10) and must never be mistaken for a popup-tier duplicate."""
        statement = select(EmailTemplates).where(
            EmailTemplates.popup_id == popup_id,
            EmailTemplates.sales_flow_id == None,  # noqa: E711
            EmailTemplates.template_type == template_type,
        )
        return session.exec(statement).first()

    def get_by_flow_and_type(
        self, session: Session, sales_flow_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        """Flow tier — mirrors `get_by_popup_and_type` for the flow-scoped
        duplicate check (sdd/sales-flows slice 10)."""
        statement = select(EmailTemplates).where(
            EmailTemplates.sales_flow_id == sales_flow_id,
            EmailTemplates.template_type == template_type,
        )
        return session.exec(statement).first()

    def get_by_tenant_and_type(
        self, session: Session, tenant_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        statement = select(EmailTemplates).where(
            EmailTemplates.tenant_id == tenant_id,
            EmailTemplates.popup_id == None,  # noqa: E711
            EmailTemplates.template_type == template_type,
        )
        return session.exec(statement).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[EmailTemplates], int]:
        statement = select(EmailTemplates).where(EmailTemplates.popup_id == popup_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_by_tenant_scope(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[EmailTemplates], int]:
        statement = select(EmailTemplates).where(
            EmailTemplates.tenant_id == tenant_id,
            EmailTemplates.popup_id == None,  # noqa: E711
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def get_active_flow_template(
        self, session: Session, sales_flow_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        """This flow's template, or None.

        An inactive row is deliberately NOT returned: the caller falls
        through to the shipped file template rather than failing, and since
        slice 6 there is no popup tier in between.
        """
        statement = select(EmailTemplates).where(
            EmailTemplates.sales_flow_id == sales_flow_id,
            EmailTemplates.template_type == template_type,
            EmailTemplates.is_active == True,  # noqa: E712
        )
        return session.exec(statement).first()

    def get_active_popup_template(
        self, session: Session, popup_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        """This popup's template, or None.

        Owns the mails a gathering sends regardless of how anyone bought —
        event invitations, schedule changes, the check-in pass. Those have
        no sales flow at send time, which is why slice 6 deleting this tier
        stopped them resolving anything (sdd/sales-flows-rediseno).

        Scoped to `sales_flow_id IS NULL` so a flow-tier row of the same
        type can never answer for the popup tier.
        """
        statement = select(EmailTemplates).where(
            EmailTemplates.popup_id == popup_id,
            EmailTemplates.sales_flow_id == None,  # noqa: E711
            EmailTemplates.template_type == template_type,
            EmailTemplates.is_active == True,  # noqa: E712
        )
        return session.exec(statement).first()

    def get_active_tenant_template(
        self, session: Session, tenant_id: uuid.UUID, template_type: str
    ) -> EmailTemplates | None:
        statement = select(EmailTemplates).where(
            EmailTemplates.tenant_id == tenant_id,
            EmailTemplates.popup_id == None,  # noqa: E711
            EmailTemplates.template_type == template_type,
            EmailTemplates.is_active == True,  # noqa: E712
        )
        return session.exec(statement).first()


email_template_crud = EmailTemplateCRUD()
