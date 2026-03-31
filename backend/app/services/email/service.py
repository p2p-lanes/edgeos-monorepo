import datetime
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import TYPE_CHECKING, Any

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from jinja2.sandbox import SandboxedEnvironment
from loguru import logger
from premailer import transform
from sqlmodel import Session

from app.api.email_template.schemas import EmailTemplateType
from app.core.config import settings
from app.services.email.templates import (
    TEMPLATE_TYPE_TO_FILE,
    AbandonedCartContext,
    ApplicationAcceptedContext,
    ApplicationAcceptedScholarshipRejectedContext,
    ApplicationAcceptedWithDiscountContext,
    ApplicationAcceptedWithIncentiveContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    EditPassesConfirmedContext,
    EmailTemplates,
    LoginCodeHumanContext,
    LoginCodeUserContext,
    PaymentConfirmedContext,
    SilentUndefined,
    log_missing_template_variables,
)

if TYPE_CHECKING:
    from app.api.payment.models import Payments


@dataclass
class EmailAttachment:
    """A file attachment for an email."""

    filename: str
    content: bytes
    mime_type: str = "application/octet-stream"


def compute_order_summary(payment: "Payments") -> str:
    """Pre-render payment products into an HTML summary for custom templates.

    Returns a ``<br>``-joined HTML string with each product line showing
    the product name, attendee name, and price.
    """
    lines: list[str] = []
    for ps in payment.products_snapshot:
        attendee_name = ps.attendee.name if ps.attendee else "N/A"
        lines.append(
            f"<strong>{ps.product_name}</strong> ({attendee_name})"
            f" — ${float(ps.product_price):.2f}"
        )
    return "<br>".join(lines)


def _enrich_with_popup_data(
    context: dict[str, Any], popup_id: uuid.UUID, db_session: Session
) -> dict[str, Any]:
    """Add popup fields to context with popup_ prefix (skip if already present)."""
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db_session, popup_id)
    if not popup:
        return context

    enriched = dict(context)
    popup_fields: dict[str, Any] = {
        "popup_name": popup.name,
        "popup_image_url": popup.image_url,
        "popup_icon_url": popup.icon_url,
        "popup_web_url": popup.web_url,
        "popup_blog_url": popup.blog_url,
        "popup_twitter_url": popup.twitter_url,
        "popup_start_date": popup.start_date.strftime("%B %d, %Y")
        if popup.start_date
        else None,
        "popup_end_date": popup.end_date.strftime("%B %d, %Y")
        if popup.end_date
        else None,
    }

    # Build portal_url from tenant (respects active custom domain)
    if "portal_url" not in enriched:
        from app.api.tenant.models import Tenants
        from app.api.tenant.utils import get_portal_url

        tenant = db_session.get(Tenants, popup.tenant_id)
        if tenant:
            popup_fields["portal_url"] = get_portal_url(tenant)

    for key, value in popup_fields.items():
        if key not in enriched:
            enriched[key] = value

    return enriched


class EmailService:
    def __init__(self) -> None:
        template_dir = Path("app/templates/emails")
        self.template_env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=True,
            undefined=SilentUndefined,
        )

        self.template_env.globals.update(
            {
                "project_name": settings.PROJECT_NAME,
                "current_year": datetime.datetime.now().year,
            }
        )

    def render_custom_template(
        self, html_content: str, context: Mapping[str, Any]
    ) -> str:
        """Render user-provided HTML template with sandboxed Jinja2.

        Uses SandboxedEnvironment to prevent SSTI attacks.
        """
        try:
            env = SandboxedEnvironment(undefined=SilentUndefined)
            env.globals.update(
                {
                    "project_name": settings.PROJECT_NAME,
                    "current_year": datetime.datetime.now().year,
                }
            )
            template = env.from_string(html_content)
            html = template.render(**context)
            return transform(html)
        except Exception as e:
            logger.error(f"Error rendering custom template: {e}")
            raise

    def render_preview_template(
        self, html_content: str, context: Mapping[str, Any]
    ) -> str:
        """Render user-provided HTML for live preview.

        Uses _PreservingUndefined so that variables without a value render
        as ``{{ variable_name }}`` instead of raising an error.
        """
        from app.services.email.templates import PreservingUndefined

        try:
            env = SandboxedEnvironment(undefined=PreservingUndefined)
            env.globals.update(
                {
                    "project_name": settings.PROJECT_NAME,
                    "current_year": datetime.datetime.now().year,
                }
            )
            template = env.from_string(html_content)
            html = template.render(**context)
            return transform(html)
        except Exception as e:
            logger.error(f"Error rendering preview template: {e}")
            raise

    def render_with_fallback(
        self,
        template_type: EmailTemplateType,
        context: Mapping[str, Any],
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> tuple[str, str | None]:
        """Render email using DB-stored custom template or file-based fallback.

        Returns:
            Tuple of (rendered_html, custom_subject_or_none)
        """
        if popup_id and db_session:
            from app.api.email_template.crud import email_template_crud

            custom = email_template_crud.get_active_template(
                db_session, popup_id, template_type.value
            )
            if custom:
                rendered_html = self.render_custom_template(
                    custom.html_content, context
                )
                rendered_subject = None
                if custom.subject:
                    env = SandboxedEnvironment()
                    rendered_subject = env.from_string(custom.subject).render(**context)
                return rendered_html, rendered_subject

        # Fallback to file-based template
        file_path = TEMPLATE_TYPE_TO_FILE.get(template_type)
        if not file_path:
            raise ValueError(f"No file mapping for template type: {template_type}")

        rendered_html = self.render_template(file_path, context)
        return rendered_html, None

    def render_template(self, template_name: str, context: Mapping[str, Any]) -> str:
        """
        Render an email template with the given context.

        Args:
            template_name: Name of the template file (e.g., 'transactional/welcome.html')
            context: Dictionary of variables to pass to the template

        Returns:
            Rendered HTML with inlined CSS

        Raises:
            TemplateNotFound: If the template doesn't exist
        """
        try:
            template = self.template_env.get_template(template_name)
            html = template.render(**context)

            # Inline CSS for better email client compatibility
            return transform(html)
        except TemplateNotFound:
            logger.error(f"Email template not found: {template_name}")
            raise
        except Exception as e:
            logger.error(f"Error rendering email template {template_name}: {e}")
            raise

    async def send_email(
        self,
        to: str | list[str],
        subject: str,
        html_content: str,
        text_content: str | None = None,
        from_address: str | None = None,
        from_name: str | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        """
        Send an email via SMTP.

        Args:
            to: Recipient email address(es)
            subject: Email subject line
            html_content: HTML content of the email
            text_content: Optional plain text version
            from_address: Override default from address (tenant-specific)
            from_name: Override default from name (tenant-specific)
            attachments: Optional list of file attachments

        Returns:
            True if email was sent successfully, False otherwise
        """
        assert settings.emails_enabled, "No provided configuration for email variables"

        try:
            # Use tenant-specific email config or fall back to global settings
            sender_email = from_address or settings.SENDER_EMAIL
            sender_name = from_name or settings.SENDER_NAME

            if not sender_email:
                logger.error("No from address configured (neither tenant nor global)")
                return False

            # Build the text/html alternative part
            alt_part = MIMEMultipart("alternative")
            if text_content:
                alt_part.attach(MIMEText(text_content, "plain"))
            alt_part.attach(MIMEText(html_content, "html"))

            # If there are attachments, wrap in a mixed container
            if attachments:
                message = MIMEMultipart("mixed")
                message.attach(alt_part)
                for att in attachments:
                    maintype, _, subtype = att.mime_type.partition("/")
                    part = MIMEBase(maintype, subtype or "octet-stream")
                    part.set_payload(att.content)
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        "attachment",
                        filename=att.filename,
                    )
                    message.attach(part)
            else:
                message = alt_part

            message["Subject"] = subject
            message["From"] = f"{sender_name} <{sender_email}>"

            # Handle multiple recipients
            if isinstance(to, list):
                message["To"] = ", ".join(to)
                recipients = to
            else:
                message["To"] = to
                recipients = [to]

            smtp_kwargs: dict[str, Any] = {
                "hostname": settings.SMTP_HOST,
                "port": settings.SMTP_PORT,
                "start_tls": settings.SMTP_TLS,
                "use_tls": settings.SMTP_SSL,
            }

            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                smtp_kwargs["username"] = settings.SMTP_USER
                smtp_kwargs["password"] = settings.SMTP_PASSWORD

            await aiosmtplib.send(message, **smtp_kwargs)

            logger.info(f"Email sent successfully to {recipients}")
            return True

        except aiosmtplib.SMTPException as e:
            logger.error(f"SMTP error sending email to {to}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending email to {to}: {e}")
            return False

    async def send_template_email(
        self,
        to: str | list[str],
        subject: str,
        template_name: str,
        context: Mapping[str, Any],
        text_content: str | None = None,
        from_address: str | None = None,
        from_name: str | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        """
        Render and send a templated email.

        Args:
            to: Recipient email address(es)
            subject: Email subject line
            template_name: Name of the template file
            context: Variables to pass to the template
            text_content: Optional plain text version
            from_address: Override default from address (tenant-specific)
            from_name: Override default from name (tenant-specific)
            attachments: Optional list of file attachments

        Returns:
            True if email was sent successfully, False otherwise
        """
        try:
            # Render template
            html_content = self.render_template(template_name, context)

            # Send email
            return await self.send_email(
                to=to,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                from_address=from_address,
                from_name=from_name,
                attachments=attachments,
            )

        except Exception as e:
            logger.error(f"Error sending template email to {to}: {e}")
            return False

    async def send_login_code_user(
        self,
        to: str,
        subject: str,
        context: LoginCodeUserContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send login code email to backoffice user."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.LOGIN_CODE_USER,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_login_code_human(
        self,
        to: str,
        subject: str,
        context: LoginCodeHumanContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send login code email to portal user (human)."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.LOGIN_CODE_HUMAN,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_application_received(
        self,
        to: str,
        subject: str,
        context: ApplicationReceivedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application received confirmation email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_RECEIVED,
            template_name=EmailTemplates.APPLICATION_RECEIVED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_application_accepted(
        self,
        to: str,
        subject: str,
        context: ApplicationAcceptedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application accepted email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_ACCEPTED,
            template_name=EmailTemplates.APPLICATION_ACCEPTED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_application_rejected(
        self,
        to: str,
        subject: str,
        context: ApplicationRejectedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application rejected email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_REJECTED,
            template_name=EmailTemplates.APPLICATION_REJECTED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_application_accepted_with_discount(
        self,
        to: str,
        subject: str,
        context: ApplicationAcceptedWithDiscountContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application accepted email with scholarship discount (no cash incentive)."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_ACCEPTED_WITH_DISCOUNT,
            template_name=EmailTemplates.APPLICATION_ACCEPTED_WITH_DISCOUNT,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_application_accepted_with_incentive(
        self,
        to: str,
        subject: str,
        context: ApplicationAcceptedWithIncentiveContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application accepted email with scholarship discount and cash incentive grant."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_ACCEPTED_WITH_INCENTIVE,
            template_name=EmailTemplates.APPLICATION_ACCEPTED_WITH_INCENTIVE,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_application_accepted_scholarship_rejected(
        self,
        to: str,
        subject: str,
        context: ApplicationAcceptedScholarshipRejectedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send application accepted email when scholarship request was not approved."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED,
            template_name=EmailTemplates.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_payment_confirmed(
        self,
        to: str,
        subject: str,
        context: PaymentConfirmedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        """Send payment confirmed email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.PAYMENT_CONFIRMED,
            template_name=EmailTemplates.PAYMENT_CONFIRMED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
            attachments=attachments,
        )

    async def send_abandoned_cart(
        self,
        to: str,
        subject: str,
        context: AbandonedCartContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send abandoned cart email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.ABANDONED_CART,
            template_name=EmailTemplates.ABANDONED_CART,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def send_edit_passes_confirmed(
        self,
        to: str,
        subject: str,
        context: EditPassesConfirmedContext,
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
    ) -> bool:
        """Send pass modification confirmed email."""
        return await self._send_with_fallback(
            to=to,
            subject=subject,
            template_type=EmailTemplateType.EDIT_PASSES_CONFIRMED,
            template_name=EmailTemplates.EDIT_PASSES_CONFIRMED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
            popup_id=popup_id,
            db_session=db_session,
        )

    async def _send_with_fallback(
        self,
        to: str,
        subject: str,
        template_type: EmailTemplateType,
        template_name: str,
        context: Mapping[str, Any],
        from_address: str | None = None,
        from_name: str | None = None,
        popup_id: uuid.UUID | None = None,
        db_session: Session | None = None,
        attachments: list[EmailAttachment] | None = None,
    ) -> bool:
        """Send email using DB custom template if available, else file-based fallback."""
        try:
            enriched_context: Mapping[str, Any] = context
            if popup_id and db_session:
                enriched_context = _enrich_with_popup_data(
                    dict(context), popup_id, db_session
                )
                log_missing_template_variables(template_type, dict(enriched_context))
                rendered_html, custom_subject = self.render_with_fallback(
                    template_type, enriched_context, popup_id, db_session
                )
                final_subject = custom_subject or subject
                return await self.send_email(
                    to=to,
                    subject=final_subject,
                    html_content=rendered_html,
                    from_address=from_address,
                    from_name=from_name,
                    attachments=attachments,
                )

            return await self.send_template_email(
                to=to,
                subject=subject,
                template_name=template_name,
                context=enriched_context,
                from_address=from_address,
                from_name=from_name,
                attachments=attachments,
            )
        except Exception as e:
            logger.error(f"Error sending email with fallback to {to}: {e}")
            return False


# Singleton instance
_email_service: EmailService | None = None


def get_email_service() -> EmailService:
    """
    Get or create the email service singleton.

    Returns:
        EmailService instance
    """
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
