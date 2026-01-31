import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.application.models import Applications, ApplicationSnapshots
from app.api.application.schemas import (
    ApplicationAdminCreate,
    ApplicationCreate,
    ApplicationStatus,
    ApplicationUpdate,
)
from app.api.attendee.crud import attendees_crud, generate_check_in_code
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.schemas import HumanCreate, HumanUpdate
from app.api.shared.crud import BaseCRUD


class ApplicationsCRUD(BaseCRUD[Applications, ApplicationCreate, ApplicationUpdate]):
    """CRUD operations for Applications."""

    def __init__(self) -> None:
        super().__init__(Applications)

    def get_by_human_popup(
        self, session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
    ) -> Applications | None:
        """Get an application by human_id and popup_id."""
        statement = select(Applications).where(
            Applications.human_id == human_id,
            Applications.popup_id == popup_id,
        )
        return session.exec(statement).first()

    def find_by_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Applications], int]:
        """Find applications by human_id with eager loading."""
        base_statement = select(Applications).where(Applications.human_id == human_id)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        status_filter: ApplicationStatus | None = None,
    ) -> tuple[list[Applications], int]:
        """Find applications by popup_id with optional status filter and eager loading."""
        base_statement = select(Applications).where(Applications.popup_id == popup_id)

        if status_filter:
            base_statement = base_statement.where(
                Applications.status == status_filter.value
            )

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def create_internal(
        self,
        session: Session,
        app_data: ApplicationCreate,
        tenant_id: uuid.UUID,
        human_id: uuid.UUID,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Create an application with internal fields.

        This also updates the Human's profile with any provided profile fields.
        """
        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud
        from app.api.popup.crud import popups_crud

        # Get popup for check-in code prefix
        popup = popups_crud.get(session, app_data.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # Validate custom_fields against form field definitions
        if validate_custom_fields and app_data.custom_fields:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session, app_data.popup_id, app_data.custom_fields
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Get human
        human = humans_crud.get(session, human_id)
        if not human:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Human not found",
            )

        # Update human profile with any provided profile fields
        profile_fields = [
            "first_name",
            "last_name",
            "telegram",
            "organization",
            "role",
            "gender",
            "age",
            "residence",
        ]
        profile_update = {}
        for field in profile_fields:
            value = getattr(app_data, field, None)
            if value is not None:
                profile_update[field] = value

        if profile_update:
            humans_crud.update(session, human, HumanUpdate(**profile_update))

        # Build application data (only application-specific fields)
        app_fields = [
            "popup_id",
            "referral",
            "info_not_shared",
            "custom_fields",
            "status",
            "group_id",
        ]
        data = {
            k: v
            for k, v in app_data.model_dump().items()
            if k in app_fields and v is not None
        }
        data["tenant_id"] = tenant_id
        data["human_id"] = human_id

        # Set submitted_at if status is IN_REVIEW or ACCEPTED
        if app_data.status in [
            ApplicationStatus.IN_REVIEW.value,
            ApplicationStatus.ACCEPTED.value,
            "in review",
            "accepted",
        ]:
            data["submitted_at"] = datetime.now(timezone.utc)

        # Convert status enum to string if needed
        if data.get("status") and hasattr(data["status"], "value"):
            data["status"] = data["status"].value

        application = Applications(**data)
        session.add(application)
        session.flush()

        # Create main attendee
        prefix = popup.slug[:3].upper() if popup.slug else "ATT"
        check_in_code = generate_check_in_code(prefix)

        # Get name from human (just updated)
        session.refresh(human)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )

        attendees_crud.create_internal(
            session,
            tenant_id=tenant_id,
            application_id=application.id,
            name=name,
            category="main",
            check_in_code=check_in_code,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
        )

        # Create companion attendees (spouse/kids) if provided
        if app_data.companions:
            self._create_companions(
                session,
                application=application,
                companions=app_data.companions,
                tenant_id=tenant_id,
                check_in_prefix=prefix,
            )

        session.commit()
        session.refresh(application)
        return application

    def _create_companions(
        self,
        session: Session,
        application: Applications,
        companions: list,
        tenant_id: uuid.UUID,
        check_in_prefix: str,
    ) -> None:
        """Create companion attendees (spouse/kids) for an application.

        Validates that only one spouse can exist per application.
        """
        spouse_count = 0

        for companion in companions:
            # Validate single spouse
            if companion.category == "spouse":
                spouse_count += 1
                if spouse_count > 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Only one spouse attendee allowed per application",
                    )

            check_in_code = generate_check_in_code(check_in_prefix)
            attendees_crud.create_internal(
                session,
                tenant_id=tenant_id,
                application_id=application.id,
                name=companion.name,
                category=companion.category,
                check_in_code=check_in_code,
                email=companion.email,
                gender=companion.gender,
            )

    def create_admin(
        self,
        session: Session,
        app_data: ApplicationAdminCreate,
        tenant_id: uuid.UUID,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Create an application as admin.

        This will find or create a Human record based on email,
        then create the application with the specified status.
        """
        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud
        from app.api.popup.crud import popups_crud

        # Get popup for check-in code prefix
        popup = popups_crud.get(session, app_data.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # Validate custom_fields against form field definitions
        if validate_custom_fields and app_data.custom_fields:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session, app_data.popup_id, app_data.custom_fields
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Find or create human by email
        human = humans_crud.get_by_email(session, app_data.email)
        if not human:
            # Create new human
            human = humans_crud.create_internal(
                session,
                human_data=HumanCreate(
                    email=app_data.email,
                    first_name=app_data.first_name,
                    last_name=app_data.last_name,
                    telegram=app_data.telegram,
                    organization=app_data.organization,
                    role=app_data.role,
                    gender=app_data.gender,
                    age=app_data.age,
                    residence=app_data.residence,
                ),
                tenant_id=tenant_id,
            )
        else:
            # Update existing human profile
            profile_fields = [
                "first_name",
                "last_name",
                "telegram",
                "organization",
                "role",
                "gender",
                "age",
                "residence",
            ]
            profile_update = {}
            for field in profile_fields:
                value = getattr(app_data, field, None)
                if value is not None:
                    profile_update[field] = value

            if profile_update:
                humans_crud.update(session, human, HumanUpdate(**profile_update))

        # Check for existing application
        existing = self.get_by_human_popup(
            session, human_id=human.id, popup_id=app_data.popup_id
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An application already exists for this human and popup",
            )

        # Build application data
        app_fields = [
            "popup_id",
            "referral",
            "info_not_shared",
            "custom_fields",
            "status",
            "group_id",
        ]
        data = {
            k: v
            for k, v in app_data.model_dump().items()
            if k in app_fields and v is not None
        }
        data["tenant_id"] = tenant_id
        data["human_id"] = human.id

        # Convert status enum to string
        if data.get("status") and hasattr(data["status"], "value"):
            data["status"] = data["status"].value

        # Always set submitted_at on creation
        data["submitted_at"] = datetime.now(timezone.utc)

        # Set accepted_at if status is accepted
        if data.get("status") in [ApplicationStatus.ACCEPTED.value, "accepted"]:
            data["accepted_at"] = datetime.now(timezone.utc)

        # Capture the custom fields schema at submission time
        data["custom_fields_schema"] = form_fields_crud.build_schema_for_popup(
            session, app_data.popup_id
        )

        application = Applications(**data)
        session.add(application)
        session.flush()

        # Create main attendee
        prefix = popup.slug[:3].upper() if popup.slug else "ATT"
        check_in_code = generate_check_in_code(prefix)

        session.refresh(human)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )

        attendees_crud.create_internal(
            session,
            tenant_id=tenant_id,
            application_id=application.id,
            name=name,
            category="main",
            check_in_code=check_in_code,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
        )

        # Create companion attendees (spouse/kids) if provided
        if app_data.companions:
            self._create_companions(
                session,
                application=application,
                companions=app_data.companions,
                tenant_id=tenant_id,
                check_in_prefix=prefix,
            )

        session.commit()
        session.refresh(application)
        return application

    def update_with_profile(
        self,
        session: Session,
        application: Applications,
        update_data: ApplicationUpdate,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Update application and human profile.

        Profile fields in update_data are applied to the Human record.
        Application fields are applied to the Application record.
        """
        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud

        # Validate custom_fields if being updated
        if validate_custom_fields and update_data.custom_fields is not None:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session, application.popup_id, update_data.custom_fields
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Separate profile fields from application fields
        profile_fields = [
            "first_name",
            "last_name",
            "telegram",
            "organization",
            "role",
            "gender",
            "age",
            "residence",
        ]
        app_fields = ["referral", "info_not_shared", "custom_fields", "status"]

        # Update human profile
        profile_update = {}
        for field in profile_fields:
            value = getattr(update_data, field, None)
            if value is not None:
                profile_update[field] = value

        if profile_update and application.human:
            humans_crud.update(
                session, application.human, HumanUpdate(**profile_update)
            )

        # Update application
        app_update = {}
        for field in app_fields:
            value = getattr(update_data, field, None)
            if value is not None:
                app_update[field] = value

        if app_update:
            for key, value in app_update.items():
                if hasattr(value, "value"):
                    value = value.value
                setattr(application, key, value)

        session.add(application)
        session.commit()
        session.refresh(application)
        return application

    def create_snapshot(
        self,
        session: Session,
        application: Applications,
        event: str,
    ) -> ApplicationSnapshots:
        """Create a snapshot of the application and human profile state."""
        snapshot = application.create_snapshot(event)
        session.add(snapshot)
        session.commit()
        session.refresh(snapshot)
        return snapshot

    def submit(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Submit an application.

        If no approval strategy exists or strategy is AUTO_ACCEPT, the application
        is automatically accepted. Otherwise, sets status to IN_REVIEW for manual review.
        """
        from app.api.approval_strategy.crud import approval_strategies_crud
        from app.api.approval_strategy.schemas import ApprovalStrategyType

        application.submitted_at = datetime.now(timezone.utc)

        # Check approval strategy - no strategy means auto-accept
        strategy = approval_strategies_crud.get_by_popup(session, application.popup_id)
        should_auto_accept = (
            strategy is None or strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        )

        if should_auto_accept:
            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(timezone.utc)
            session.add(application)
            self.create_snapshot(session, application, "auto_accepted")
        else:
            application.status = ApplicationStatus.IN_REVIEW.value
            session.add(application)
            self.create_snapshot(session, application, "submitted")

        session.commit()
        session.refresh(application)
        return application

    def accept(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Accept an application and create snapshot."""
        application.status = ApplicationStatus.ACCEPTED.value
        application.accepted_at = datetime.now(timezone.utc)
        session.add(application)

        # Create snapshot
        self.create_snapshot(session, application, "accepted")

        session.commit()
        session.refresh(application)
        return application

    def create_attendee(
        self,
        session: Session,
        application: Applications,
        name: str,
        category: str,
        email: str | None = None,
        gender: str | None = None,
    ):
        """Add an attendee to an application."""
        # Validate category doesn't already exist for main/spouse
        existing_categories = {a.category for a in application.attendees}
        if category in ["main", "spouse"] and category in existing_categories:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attendee with category '{category}' already exists",
            )

        # Check for duplicate emails
        if email:
            existing_emails = [a.email for a in application.attendees if a.email]
            if email.lower() in existing_emails:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Attendee with this email already exists",
                )

        # Generate check-in code
        prefix = application.popup.slug[:3].upper() if application.popup.slug else "ATT"
        check_in_code = generate_check_in_code(prefix)

        attendee = attendees_crud.create_internal(
            session,
            tenant_id=application.tenant_id,
            application_id=application.id,
            name=name,
            category=category,
            check_in_code=check_in_code,
            email=email.lower() if email else None,
            gender=gender,
        )

        session.refresh(application)
        return attendee

    def delete_attendee(
        self,
        session: Session,
        application: Applications,
        attendee_id: uuid.UUID,
    ) -> None:
        """Delete an attendee from an application."""
        attendee = next((a for a in application.attendees if a.id == attendee_id), None)
        if not attendee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendee not found",
            )

        if attendee.category == "main":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete main attendee",
            )

        attendees_crud.delete_attendee(session, attendee)
        session.refresh(application)

    def delete(self, session: Session, db_obj: Applications) -> None:
        """Delete an application, checking for payment history."""
        # Check if any attendees have payment history
        for attendee in db_obj.attendees:
            if attendee.payment_products:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot delete application with payment history",
                )

        # Delete attendee products first
        for attendee in db_obj.attendees:
            for ap in attendee.attendee_products:
                session.delete(ap)

        session.delete(db_obj)
        session.commit()


applications_crud = ApplicationsCRUD()
