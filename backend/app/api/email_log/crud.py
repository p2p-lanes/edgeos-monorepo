"""CRUD helpers for the email log.

Write path: ``create`` records one row per dispatched email. Read path:
``get_reminder_stats`` powers the reminder dispatcher's cadence/cap logic by
counting successfully sent emails of a given type for a given entity.
"""

import uuid
from datetime import datetime

from sqlalchemy import func
from sqlmodel import Session, select

from app.api.email_log.models import EmailLogs
from app.api.email_log.schemas import EmailLogStatus


class EmailLogCRUD:
    def create(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        template_type: str,
        to_email: str,
        status: EmailLogStatus | str,
        popup_id: uuid.UUID | None = None,
        application_id: uuid.UUID | None = None,
        payment_id: uuid.UUID | None = None,
        human_id: uuid.UUID | None = None,
        subject: str | None = None,
        error: str | None = None,
    ) -> EmailLogs:
        """Append one email log row and flush it (caller owns the commit)."""
        log = EmailLogs(
            tenant_id=tenant_id,
            popup_id=popup_id,
            template_type=str(template_type),
            to_email=to_email,
            application_id=application_id,
            payment_id=payment_id,
            human_id=human_id,
            subject=subject,
            status=str(status),
            error=error,
        )
        session.add(log)
        session.flush()
        return log

    def get_reminder_stats(
        self,
        session: Session,
        *,
        template_type: str,
        popup_id: uuid.UUID | None = None,
        application_id: uuid.UUID | None = None,
        payment_id: uuid.UUID | None = None,
        to_email: str | None = None,
    ) -> tuple[int, datetime | None]:
        """Return (successful_send_count, last_sent_at) for a reminder target.

        Counts only rows with status ``sent`` for the given template type,
        scoped by whichever entity key is provided (plus ``popup_id`` so an
        email-keyed count never conflates two popups). Used to enforce the
        per-popup cadence (repeat every M days) and cap (max K sends).
        """
        conditions = [
            EmailLogs.template_type == str(template_type),
            EmailLogs.status == EmailLogStatus.SENT.value,
        ]
        if popup_id is not None:
            conditions.append(EmailLogs.popup_id == popup_id)
        if application_id is not None:
            conditions.append(EmailLogs.application_id == application_id)
        if payment_id is not None:
            conditions.append(EmailLogs.payment_id == payment_id)
        if to_email is not None:
            conditions.append(EmailLogs.to_email == to_email)

        row = session.exec(
            select(
                func.count(EmailLogs.id),
                func.max(EmailLogs.created_at),
            ).where(*conditions)
        ).one()
        count, last_sent_at = row
        return int(count or 0), last_sent_at


email_logs_crud = EmailLogCRUD()
