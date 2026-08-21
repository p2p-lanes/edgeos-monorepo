"""Explicit administrative application-status transitions."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlmodel import Session, col, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.application_review.schemas import ReviewDecision
from app.api.audit_log.actor import actor_from_user
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.crud import audit_logs_crud

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic


class ApplicationStatusService:
    """Own the invariant-rich, explicit admin override operation."""

    def override(
        self,
        session: Session,
        *,
        application_id: uuid.UUID,
        target_status: ApplicationStatus,
        reason: str,
        current_user: UserPublic,
    ) -> tuple[Applications, str]:
        """Stage an accepted/rejected override and its audit history.

        The caller owns commit and email dispatch. Existing payments, tickets,
        event registrations, group membership and credit movements are never
        reversed by this operation.
        """
        from app.api.application.crud import _maybe_grant_fee_credit, applications_crud
        from app.api.application.schemas import ScholarshipStatus
        from app.api.application_review.crud import application_reviews_crud

        application = session.exec(
            select(Applications)
            .where(col(Applications.id) == application_id)
            .with_for_update()
        ).first()
        if not application:
            raise HTTPException(status_code=404, detail="Application not found")

        allowed_sources = {
            ApplicationStatus.IN_REVIEW.value,
            ApplicationStatus.ACCEPTED.value,
            ApplicationStatus.REJECTED.value,
        }
        if application.status not in allowed_sources:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "status_not_overridable",
                    "message": "Only in-review, accepted, or rejected applications can be overridden.",
                    "application_status": application.status,
                },
            )

        target = target_status.value
        if target == application.status:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "status_unchanged",
                    "message": f"Application is already {target}.",
                },
            )

        human = application.human
        if target_status == ApplicationStatus.ACCEPTED:
            if human and human.red_flag:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "red_flagged_human",
                        "message": "Remove the human's red flag before accepting this application.",
                    },
                )
            if (
                application.scholarship_request
                and application.scholarship_status
                not in (
                    ScholarshipStatus.APPROVED.value,
                    ScholarshipStatus.REJECTED.value,
                )
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "scholarship_pending",
                        "message": "Resolve the scholarship request before accepting this application.",
                    },
                )

        old_status = application.status
        application.status = target
        application.accepted_at = (
            datetime.now(UTC) if target_status == ApplicationStatus.ACCEPTED else None
        )
        application.status_override_reason = reason
        application.status_overridden_at = datetime.now(UTC)
        application.status_overridden_by_user_id = current_user.id
        application.status_overridden_by_name = (
            current_user.full_name or current_user.email
        )
        application.status_overridden_by_email = current_user.email
        session.add(application)

        event = (
            "admin_accepted"
            if target_status == ApplicationStatus.ACCEPTED
            else "admin_rejected"
        )
        applications_crud.create_snapshot(session, application, event)
        if target_status == ApplicationStatus.ACCEPTED:
            _maybe_grant_fee_credit(session, application)

        counts = application_reviews_crud.count_by_decision(session, application.id)
        human_label = None
        if human:
            human_label = (
                f"{human.first_name or ''} {human.last_name or ''}".strip()
                or human.email
            )
        audit_logs_crud.record(
            session,
            tenant_id=application.tenant_id,
            actor=actor_from_user(current_user),
            action=AuditAction.APPLICATION_STATUS_OVERRIDDEN,
            entity_type=AuditEntityType.APPLICATION,
            entity_id=application.id,
            entity_label=human_label,
            popup_id=application.popup_id,
            details={
                "old_status": old_status,
                "new_status": target,
                "reason": reason,
                "review_summary": {
                    decision.value: counts[decision] for decision in ReviewDecision
                },
                "existing_financial_records_preserved": True,
            },
        )
        session.flush()
        return application, old_status


application_status_service = ApplicationStatusService()
