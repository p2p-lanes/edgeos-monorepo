import datetime
from collections.abc import Mapping
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from loguru import logger
from premailer import transform

from app.core.config import settings
from app.services.email.templates import (
    ApplicationAcceptedContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    EditPassesConfirmedContext,
    EmailTemplates,
    LoginCodeHumanContext,
    LoginCodeUserContext,
    PaymentConfirmedContext,
    PaymentPendingContext,
)


class EmailService:
    def __init__(self) -> None:
        template_dir = Path("app/templates/emails")
        self.template_env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=True,
        )

        self.template_env.globals.update(
            {
                "project_name": settings.PROJECT_NAME,
                "current_year": datetime.datetime.now().year,
            }
        )

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

            # Create message
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = f"{sender_name} <{sender_email}>"

            # Handle multiple recipients
            if isinstance(to, list):
                message["To"] = ", ".join(to)
                recipients = to
            else:
                message["To"] = to
                recipients = [to]

            # Add plain text version if provided
            if text_content:
                text_part = MIMEText(text_content, "plain")
                message.attach(text_part)

            # Add HTML version
            html_part = MIMEText(html_content, "html")
            message.attach(html_part)

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
            )

        except Exception as e:
            logger.error(f"Error sending template email to {to}: {e}")
            return False

    # =========================================================================
    # Typed Template Methods (with IDE autocomplete for context variables)
    # =========================================================================

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
    ) -> bool:
        """Send application received confirmation email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.APPLICATION_RECEIVED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_application_accepted(
        self,
        to: str,
        subject: str,
        context: ApplicationAcceptedContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send application accepted email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.APPLICATION_ACCEPTED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_application_rejected(
        self,
        to: str,
        subject: str,
        context: ApplicationRejectedContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send application rejected email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.APPLICATION_REJECTED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_payment_confirmed(
        self,
        to: str,
        subject: str,
        context: PaymentConfirmedContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send payment confirmed email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.PAYMENT_CONFIRMED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_payment_pending(
        self,
        to: str,
        subject: str,
        context: PaymentPendingContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send payment pending email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.PAYMENT_PENDING,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )

    async def send_edit_passes_confirmed(
        self,
        to: str,
        subject: str,
        context: EditPassesConfirmedContext,
        from_address: str | None = None,
        from_name: str | None = None,
    ) -> bool:
        """Send pass modification confirmed email."""
        return await self.send_template_email(
            to=to,
            subject=subject,
            template_name=EmailTemplates.EDIT_PASSES_CONFIRMED,
            context=context.model_dump(exclude_none=True),
            from_address=from_address,
            from_name=from_name,
        )


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
