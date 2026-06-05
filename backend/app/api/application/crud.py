import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import desc, exists, or_
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from app.api.application.models import Applications, ApplicationSnapshots
from app.api.application.schemas import (
    ApplicationAdminCreate,
    ApplicationCreate,
    ApplicationStatus,
    ApplicationUpdate,
    PopupAccessResponse,
    ScholarshipDecisionRequest,
)
from app.api.application_review.models import ApplicationReviews
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.human.schemas import HumanCreate, HumanUpdate
from app.api.shared.crud import BaseCRUD

if TYPE_CHECKING:
    from app.api.human.models import Humans


# Attendee categories shown in the Portal attendee directory. Kids (and any
# other non-adult categories) are intentionally excluded — only the main
# applicant and their spouse appear.
DIRECTORY_VISIBLE_CATEGORY_KEYS = ("main", "spouse")


def _is_draft_status(status_value: object) -> bool:
    """True when an application is being created/saved as a draft.

    Treats a missing status as draft because the DB column defaults to draft
    when no value is provided.
    """
    if status_value is None:
        return True
    return getattr(status_value, "value", status_value) == ApplicationStatus.DRAFT.value


class RedFlaggedHumanError(Exception):
    """Raised when attempting to accept an application from a red-flagged human."""

    pass


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
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
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
        search: str | None = None,
        reviewed_by: uuid.UUID | None = None,
    ) -> tuple[list[Applications], int]:
        """Find applications by popup_id with optional status filter and eager loading."""
        base_statement = select(Applications).where(Applications.popup_id == popup_id)

        if status_filter:
            base_statement = base_statement.where(
                Applications.status == status_filter.value
            )

        # Apply text search if provided - search in human fields
        if search:
            search_term = f"%{search}%"
            base_statement = base_statement.join(
                Humans,
                Applications.human_id == Humans.id,  # type: ignore[arg-type]
            ).where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                )
            )

        if reviewed_by:
            has_review = (
                exists()
                .where(ApplicationReviews.application_id == Applications.id)
                .where(ApplicationReviews.reviewer_id == reviewed_by)
            )
            base_statement = base_statement.where(has_review)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_status(
        self,
        session: Session,
        status_filter: ApplicationStatus,
        popup_id: uuid.UUID | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Applications], int]:
        """Find applications by status with optional popup filter and eager loading."""
        base_statement = select(Applications).where(
            Applications.status == status_filter.value
        )

        if popup_id:
            base_statement = base_statement.where(Applications.popup_id == popup_id)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_directory(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        q: str | None = None,
    ) -> tuple[list[Attendees], int]:
        """Find attendees for the attendees directory.

        Returns ticket-holding attendees whose parent application is accepted —
        one entry per person, sourced from that attendee's own Human record.
        Only the main applicant and spouse categories are listed; kids (and any
        other categories) are excluded. Supports text search across the
        attendee's own human fields.
        """
        # Root on attendees so the spouse appears as their own row, not just
        # nested under the main applicant. Gate on an accepted parent
        # application, on the attendee holding at least one product, and on the
        # category being directory-visible (main/spouse — kids are excluded).
        has_products = exists().where(AttendeeProducts.attendee_id == Attendees.id)
        base_statement = (
            select(Attendees)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .join(
                AttendeeCategories,
                Attendees.category_id == AttendeeCategories.id,  # type: ignore[arg-type]
            )
            .where(Attendees.popup_id == popup_id)
            .where(Applications.status == ApplicationStatus.ACCEPTED.value)
            .where(has_products)
            .where(col(AttendeeCategories.key).in_(DIRECTORY_VISIBLE_CATEGORY_KEYS))
        )

        # Text search across the attendee's OWN human fields, so companions are
        # searchable by their own name/email — not the main applicant's.
        if q:
            search_term = f"%{q}%"
            base_statement = base_statement.join(
                Humans,
                Attendees.human_id == Humans.id,  # type: ignore[arg-type]
            ).where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    # Full name ("first last") so a query spanning both fields —
                    # e.g. "eva shang" — matches; the per-field checks above only
                    # catch a term that fits within a single column.
                    func.concat_ws(
                        " ", Humans.first_name, Humans.last_name
                    ).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                    col(Humans.telegram).ilike(search_term),
                )
            )

        # Count
        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load: the attendee's tickets+products, its category, the parent
        # application (for main-applicant masking/custom_fields). human is
        # already selectin-loaded on the relationship.
        statement = (
            base_statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # type: ignore[arg-type]
                ),
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
                selectinload(Attendees.application),  # type: ignore[arg-type]
                selectinload(Attendees.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Attendees.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_directory_humans(
        self,
        session: Session,
        popup_id: uuid.UUID,
        q: str | None = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list["Humans"], int]:
        """Find humans in the Portal attendee directory who share their name.

        Same population as ``find_directory`` (accepted application, the attendee
        holds at least one product, directory-visible main/spouse category) but
        returns the distinct underlying Humans instead of Attendee rows. Powers
        the event host picker: a creator may only pick a host who actually
        attends this popup AND has not hidden their name for it.

        Applications that listed "first_name" or "last_name" in
        ``info_not_shared`` are excluded — picking them would surface a name the
        attendee chose to hide. Humans with no usable name are also excluded so
        the picker never renders a blank entry. Optional ``q`` does an ilike
        match on the human's first/last name.
        """
        has_products = exists().where(AttendeeProducts.attendee_id == Attendees.id)
        # info_not_shared is a Postgres text[] column, so name-hiding is detected
        # with the array-overlap operator (&&): true when the list shares any
        # element with {first_name, last_name}. (?| is a JSONB operator and does
        # NOT apply to a real array column.) Negated to EXCLUDE those rows.
        hides_name = col(Applications.info_not_shared).op("&&")(
            postgresql.array(("first_name", "last_name"))
        )
        has_name = or_(
            func.trim(func.coalesce(col(Humans.first_name), "")) != "",
            func.trim(func.coalesce(col(Humans.last_name), "")) != "",
        )

        base_statement = (
            select(Humans)
            .join(Attendees, Attendees.human_id == Humans.id)  # type: ignore[arg-type]
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .join(
                AttendeeCategories,
                Attendees.category_id == AttendeeCategories.id,  # type: ignore[arg-type]
            )
            .where(Attendees.popup_id == popup_id)
            .where(Applications.status == ApplicationStatus.ACCEPTED.value)
            .where(has_products)
            .where(col(AttendeeCategories.key).in_(DIRECTORY_VISIBLE_CATEGORY_KEYS))
            .where(~hides_name)
            .where(has_name)
        )

        if q:
            search_term = f"%{q}%"
            base_statement = base_statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    # Full name so "first last" queries match (see find_directory).
                    func.concat_ws(
                        " ", Humans.first_name, Humans.last_name
                    ).ilike(search_term),
                )
            )

        distinct_statement = base_statement.distinct()
        count_statement = select(func.count()).select_from(
            distinct_statement.subquery()
        )
        total = session.exec(count_statement).one()

        results = list(session.exec(distinct_statement.offset(skip).limit(limit)).all())
        return results, total

    def human_ids_hiding_name(
        self,
        session: Session,
        popup_id: uuid.UUID,
        human_ids: list[uuid.UUID],
    ) -> set[uuid.UUID]:
        """Return the subset of ``human_ids`` who hid their name for ``popup_id``.

        A human hides their name when their Application for the popup lists
        "first_name" or "last_name" in ``info_not_shared``. Used to drop those
        people from portal-facing participant/RSVP lists.
        """
        if not human_ids:
            return set()

        hides_name = col(Applications.info_not_shared).op("&&")(
            postgresql.array(("first_name", "last_name"))
        )
        statement = (
            select(Applications.human_id)
            .where(Applications.popup_id == popup_id)
            .where(col(Applications.human_id).in_(human_ids))
            .where(hides_name)
        )
        return set(session.exec(statement).all())

    def create_internal(
        self,
        session: Session,
        app_data: ApplicationCreate | ApplicationAdminCreate,
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

        # Drafts are partial saves: skip "required field is missing" checks but
        # still validate types/constraints on any values the user did provide.
        is_draft = _is_draft_status(getattr(app_data, "status", None))

        # Applications submitted through a group come from the portal's
        # Express Checkout, which renders a reduced personal-info form. Scope
        # required validation to that subset so users aren't blocked on fields
        # the form never asked for.
        is_express_checkout = bool(getattr(app_data, "group_id", None))

        # Validate custom_fields against form field definitions
        if validate_custom_fields and app_data.custom_fields:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session,
                app_data.popup_id,
                app_data.custom_fields,
                skip_required=is_draft,
                is_express_checkout=is_express_checkout,
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

        # Validate required base fields against BaseFieldConfigs
        if validate_custom_fields and not is_draft:
            is_valid, errors = form_fields_crud.validate_base_fields(
                session,
                app_data.popup_id,
                app_data.model_dump(),
                human,
                is_express_checkout=is_express_checkout,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid base fields", "errors": errors},
                )

        # Validate group whitelist if group_id provided
        if hasattr(app_data, "group_id") and app_data.group_id:
            from app.api.group.crud import groups_crud

            group = groups_crud.get(session, app_data.group_id)
            if not group:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found",
                )

            # Check if group belongs to same popup
            if group.popup_id != app_data.popup_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Group does not belong to this popup",
                )

            # Check whitelist (skip if group is open - has no whitelisted emails)
            if not group.is_open and not group.has_whitelisted_email(human.email):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your email is not whitelisted for this group",
                )

        # Update human profile with any provided profile fields
        profile_fields = [
            "first_name",
            "last_name",
            "telegram",
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
            # Scholarship human-submittable fields (Phase 2.2)
            "scholarship_request",
            "scholarship_details",
            "scholarship_video_url",
        ]
        data = {
            k: v
            for k, v in app_data.model_dump().items()
            if k in app_fields and v is not None
        }
        data["tenant_id"] = tenant_id
        data["human_id"] = human_id

        # Auto-accept applications that come through a group (checkout/referral)
        if data.get("group_id"):
            if human.red_flag:
                data["status"] = ApplicationStatus.REJECTED.value
            else:
                data["status"] = ApplicationStatus.ACCEPTED.value
                data["accepted_at"] = datetime.now(UTC)

        # Set submitted_at if status is IN_REVIEW or ACCEPTED
        if app_data.status in [
            ApplicationStatus.IN_REVIEW.value,
            ApplicationStatus.ACCEPTED.value,
            "in review",
            "accepted",
        ]:
            data["submitted_at"] = datetime.now(UTC)

        # Convert status enum to string if needed
        if data.get("status") and hasattr(data["status"], "value"):
            data["status"] = data["status"].value

        # Capture the custom fields schema at submission time
        data["custom_fields_schema"] = form_fields_crud.build_schema_for_popup(
            session, app_data.popup_id
        )

        application = Applications(**data)
        session.add(application)
        session.flush()

        # Create main attendee
        # Get name from human (just updated)
        session.refresh(human)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )

        # Look up the popup's primary category to set category_id on the main attendee
        from app.api.attendee_category.crud import (
            attendee_categories_crud,  # noqa: PLC0415
        )

        main_cat = attendee_categories_crud.get_primary_for_popup(
            session, application.popup_id
        )

        attendees_crud.create_internal(
            session,
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            name=name,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
            category_id=main_cat.id if main_cat else None,
        )

        # Apply approval strategy for non-group applications still in review
        if (
            not data.get("group_id")
            and application.status == ApplicationStatus.IN_REVIEW.value
        ):
            # Intercept: if popup requires application fee, gate on PENDING_FEE
            if popup.requires_application_fee:
                application.status = ApplicationStatus.PENDING_FEE.value
                self.create_snapshot(session, application, "pending_fee")
            else:
                self._apply_approval_strategy(session, application, human)

        # Create snapshot for group auto-accept/reject
        if data.get("group_id"):
            event = (
                "auto_rejected"
                if application.status == ApplicationStatus.REJECTED.value
                else "auto_accepted"
            )
            self.create_snapshot(session, application, event)

        # Sync membership junction: Application.group_id records origin (historical),
        # GroupMembers records currently-active membership. Keep them aligned on creation
        # so max_members validation and is_member() reflect the new application.
        if data.get("group_id") and not human.red_flag:
            from app.api.group.models import GroupMembers  # noqa: PLC0415

            existing_member = session.exec(
                select(GroupMembers).where(
                    GroupMembers.group_id == data["group_id"],
                    GroupMembers.human_id == human_id,
                )
            ).first()
            if not existing_member:
                session.add(
                    GroupMembers(
                        tenant_id=tenant_id,
                        group_id=data["group_id"],
                        human_id=human_id,
                    )
                )

        session.commit()
        session.refresh(application)
        return application

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

        # Drafts are partial saves: skip "required field is missing" checks but
        # still validate types/constraints on any values the user did provide.
        is_draft = _is_draft_status(getattr(app_data, "status", None))

        # Group applications use the Express Checkout reduced form on the
        # portal; mirror that scope here when the admin creates one too.
        is_express_checkout = bool(getattr(app_data, "group_id", None))

        # Validate custom_fields against form field definitions
        if validate_custom_fields and app_data.custom_fields:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session,
                app_data.popup_id,
                app_data.custom_fields,
                skip_required=is_draft,
                is_express_checkout=is_express_checkout,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Find or create human by email
        human = humans_crud.get_by_email(session, app_data.email)
        if not human:
            if not app_data.first_name or not app_data.last_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Human with email '{app_data.email}' not found. "
                    "first_name and last_name are required to create a new human record.",
                )
            # Create new human
            human = humans_crud.create_internal(
                session,
                human_data=HumanCreate(
                    email=app_data.email,
                    first_name=app_data.first_name,
                    last_name=app_data.last_name,
                    telegram=app_data.telegram,
                    gender=app_data.gender,
                    age=app_data.age,
                    residence=app_data.residence,
                ),
                tenant_id=tenant_id,
            )

        # Validate required base fields against BaseFieldConfigs
        if validate_custom_fields and not is_draft:
            is_valid, errors = form_fields_crud.validate_base_fields(
                session,
                app_data.popup_id,
                app_data.model_dump(),
                human,
                is_express_checkout=is_express_checkout,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid base fields", "errors": errors},
                )
        else:
            # Update existing human profile
            profile_fields = [
                "first_name",
                "last_name",
                "telegram",
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
            # Scholarship human-submittable fields
            "scholarship_request",
            "scholarship_details",
            "scholarship_video_url",
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
        data["submitted_at"] = datetime.now(UTC)

        # Set accepted_at if status is accepted
        if data.get("status") in [ApplicationStatus.ACCEPTED.value, "accepted"]:
            data["accepted_at"] = datetime.now(UTC)

        # Capture the custom fields schema at submission time
        data["custom_fields_schema"] = form_fields_crud.build_schema_for_popup(
            session, app_data.popup_id
        )

        application = Applications(**data)
        session.add(application)
        session.flush()

        # Create main attendee
        session.refresh(human)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )

        # Look up the popup's primary category to set category_id on the main attendee
        from app.api.attendee_category.crud import (
            attendee_categories_crud,  # noqa: PLC0415
        )

        main_cat = attendee_categories_crud.get_primary_for_popup(
            session, application.popup_id
        )

        attendees_crud.create_internal(
            session,
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            name=name,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
            category_id=main_cat.id if main_cat else None,
        )

        # Apply approval strategy if status is IN_REVIEW
        if application.status == ApplicationStatus.IN_REVIEW.value:
            self._apply_approval_strategy(session, application, human)

        session.commit()
        session.refresh(application)
        return application

    def _apply_approval_strategy(
        self,
        session: Session,
        application: "Applications",
        human: "Humans",
    ) -> None:
        """Apply approval strategy to determine final status.

        - Red-flagged humans → REJECTED
        - No strategy or AUTO_ACCEPT → ACCEPTED
        - Other strategies → IN_REVIEW (unchanged)
        """
        from app.api.approval_strategy.crud import approval_strategies_crud
        from app.api.approval_strategy.schemas import ApprovalStrategyType

        # Red-flagged humans are automatically rejected
        if human.red_flag:
            application.status = ApplicationStatus.REJECTED.value
            self.create_snapshot(session, application, "auto_rejected")
            return

        # Check approval strategy
        strategy = approval_strategies_crud.get_by_popup(session, application.popup_id)
        should_auto_accept = (
            strategy is None
            or strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        )

        if should_auto_accept:
            # Scholarship gate: if scholarship is requested and not yet decided,
            # hold the application in IN_REVIEW instead of auto-accepting.
            # Condition uses `not in (APPROVED, REJECTED)` to catch both None and "pending".
            from app.api.application.schemas import ScholarshipStatus

            if (
                application.scholarship_request
                and application.scholarship_status
                not in (
                    ScholarshipStatus.APPROVED.value,
                    ScholarshipStatus.REJECTED.value,
                )
            ):
                self.create_snapshot(session, application, "submitted")
                return
            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
            self.create_snapshot(session, application, "auto_accepted")
        else:
            self.create_snapshot(session, application, "submitted")

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
        """Create a snapshot of the application and human profile state.

        Uses flush (not commit) — the caller owns the transaction boundary.
        """
        snapshot = application.create_snapshot(event)
        session.add(snapshot)
        session.flush()
        return snapshot

    def promote_to_accepted(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Flush-only flip of an existing Application to ACCEPTED.

        Used by the admin bulk-grant endpoint when a Human already has an
        application for the popup but it is still in draft/in-review/etc.
        Sets `accepted_at`, writes an audit snapshot, and flushes — the
        caller owns the transaction so the entire grant batch stays atomic.

        Idempotent: a no-op when the application is already accepted.
        """
        if application.status == ApplicationStatus.ACCEPTED.value:
            return application

        application.status = ApplicationStatus.ACCEPTED.value
        application.accepted_at = datetime.now(UTC)
        session.add(application)
        self.create_snapshot(session, application, "admin_grant_accepted")
        return application

    def create_for_admin_grant(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        popup_id: uuid.UUID,
        human: "Humans",
    ) -> Applications:
        """Flush-only minimal Application + main Attendee for admin bulk grants.

        Skips custom_fields validation, approval strategy, group whitelisting,
        and the form-section fee gate — admin grants bypass user-facing checks
        because they are the staff-side equivalent of marking a ticket as comp.
        Status is hard-set to ACCEPTED and `accepted_at`/`submitted_at` are
        stamped to now.

        Caller owns the transaction boundary so a sold-out failure mid-batch
        rolls back every Human/Application/Attendee created in this run.
        """
        from app.api.attendee_category.crud import attendee_categories_crud
        from app.api.form_field.crud import form_fields_crud

        now = datetime.now(UTC)
        application = Applications(
            tenant_id=tenant_id,
            popup_id=popup_id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
            submitted_at=now,
            accepted_at=now,
            custom_fields_schema=form_fields_crud.build_schema_for_popup(
                session, popup_id
            ),
        )
        session.add(application)
        session.flush()

        main_cat = attendee_categories_crud.get_primary_for_popup(session, popup_id)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )
        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=popup_id,
            name=name,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
            category_id=main_cat.id if main_cat else None,
        )
        session.add(attendee)
        self.create_snapshot(session, application, "admin_grant_created")
        session.flush()
        return application

    def accept(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Accept an application and create snapshot.

        Raises:
            RedFlaggedHumanError: If the human is red-flagged and cannot be accepted.
        """
        # Red-flagged humans cannot be accepted
        human_red_flag = application.human.red_flag if application.human else False
        if human_red_flag:
            raise RedFlaggedHumanError(
                "Cannot accept application from a red-flagged human"
            )

        application.status = ApplicationStatus.ACCEPTED.value
        application.accepted_at = datetime.now(UTC)
        session.add(application)

        # Create snapshot — uses flush internally, caller owns the commit
        self.create_snapshot(session, application, "accepted")
        return application

    def create_attendee(
        self,
        session: Session,
        application: Applications,
        name: str,
        category_id: uuid.UUID | None = None,
        email: str | None = None,
        gender: str | None = None,
    ):
        """Add an attendee to an application.

        category_id (UUID FK) is required for any attendee beyond the primary.
        The legacy category string is no longer accepted — callers must resolve
        a category_id against the popup's attendee_categories table.
        """
        # Check for duplicate emails
        if email:
            existing_emails = [a.email for a in application.attendees if a.email]
            if email.lower() in existing_emails:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Attendee with this email already exists",
                )

        attendee = attendees_crud.create_internal(
            session,
            tenant_id=application.tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            name=name,
            email=email.lower() if email else None,
            gender=gender,
            category_id=category_id,
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

    def review_scholarship(
        self,
        session: Session,
        application_id: uuid.UUID,
        decision: ScholarshipDecisionRequest,
    ) -> Applications:
        """Apply an admin scholarship decision to an application.

        Validates popup flags, updates scholarship fields, then re-runs
        the approval calculator so the application status reflects the
        scholarship outcome (e.g., AUTO_ACCEPT gate lifts → ACCEPTED).
        """
        from app.api.application.schemas import ScholarshipStatus
        from app.api.popup.crud import popups_crud
        from app.services.approval.calculator import approval_calculator

        # 1. Fetch application
        application = self.get(session, application_id)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        # 2. Fetch popup
        popup = popups_crud.get(session, application.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # 3. Validate popup allows scholarship
        if not popup.allows_scholarship:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Scholarship is not enabled for this popup",
            )

        # 4. Validate APPROVED-specific rules
        if decision.scholarship_status == ScholarshipStatus.APPROVED:
            if decision.discount_percentage is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="discount_percentage is required when approving a scholarship",
                )
            if decision.incentive_amount is not None and not popup.allows_incentive:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Incentives are not enabled for this popup",
                )

        # 5. Update scholarship fields
        application.scholarship_status = decision.scholarship_status.value
        application.discount_percentage = decision.discount_percentage
        application.incentive_amount = decision.incentive_amount
        application.incentive_currency = decision.incentive_currency

        # 6. Persist scholarship decision
        session.add(application)
        session.flush()

        # 7. Re-evaluate application status (may lift AUTO_ACCEPT gate → ACCEPTED)
        # recalculate_status only commits internally when status actually changes.
        # If status doesn't change (e.g. application is already ACCEPTED, or strategy
        # keeps it IN_REVIEW), it returns without committing — the flush above is dangling.
        application = approval_calculator.recalculate_status(session, application)

        # 8. Commit unconditionally: guarantees scholarship fields are persisted
        # regardless of whether recalculate_status committed or not.
        session.commit()
        session.refresh(application)

        return application

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

    def resolve_popup_access(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> PopupAccessResponse:
        """Run the 7-step access ladder for (human_id, popup_id).

        Resolution order (first match wins):
        1. Accepted Application → allowed=True, source="application"
        2. Submitted or in-review Application → denied, reason="application_pending"
        3. Rejected Application → denied, reason="application_rejected"
        4. Direct Attendee row for (human_id, popup_id) → allowed, source="attendee"
        5. Payment owned by human for popup → allowed, source="payment"
        6. Companion participation (find_companion_for_popup) → allowed, source="companion"
        7. Fallback → denied, reason="no_access"

        Uses lightweight scalar/exists probes so no full row is loaded unnecessarily.
        Short-circuits at the first match — application checks run before attendee
        and payment checks to respect the application flow semantics.
        """
        from app.api.attendee.crud import attendees_crud
        from app.api.attendee.models import Attendees
        from app.api.payment.models import PaymentProducts, Payments

        # ---- Steps 1-3: Application check ----
        application = self.get_by_human_popup(session, human_id, popup_id)

        if application is not None:
            app_status = application.status

            if app_status == ApplicationStatus.ACCEPTED.value:
                return PopupAccessResponse(
                    allowed=True,
                    source="application",
                    application_status="accepted",
                )

            if app_status in (ApplicationStatus.IN_REVIEW.value, "submitted"):
                return PopupAccessResponse(
                    allowed=False,
                    application_status="in review"
                    if app_status == ApplicationStatus.IN_REVIEW.value
                    else "submitted",
                    reason="application_pending",
                )

            if app_status == ApplicationStatus.REJECTED.value:
                return PopupAccessResponse(
                    allowed=False,
                    application_status="rejected",
                    reason="application_rejected",
                )

        # ---- Step 4: Direct Attendee check ----
        # Check for attendees OWNED by this human (application owner or direct-sale).
        # This uses the same dual-path predicate as find_by_human_popup so that
        # companion attendees (whose APPLICATION.human_id != human_id) are excluded
        # here and fall through to Step 6.
        from sqlalchemy import exists as sa_exists

        union_ids = attendees_crud._human_popup_attendee_ids(
            session, human_id, popup_id
        )
        attendee_exists_stmt = select(
            sa_exists().where(
                Attendees.id.in_(select(union_ids.c.id))  # type: ignore[arg-type]
            )
        )
        has_attendee = session.exec(attendee_exists_stmt).one()

        if has_attendee:
            return PopupAccessResponse(
                allowed=True,
                source="attendee",
            )

        # ---- Step 5: Payment check ----
        # Application-leg: payment linked to an application owned by this human for this popup
        app_payment_exists = select(
            sa_exists()
            .where(Payments.popup_id == popup_id)
            .where(
                Payments.application_id.in_(  # type: ignore[union-attr]
                    select(Applications.id).where(
                        Applications.human_id == human_id,
                        Applications.popup_id == popup_id,
                    )
                )
            )
        )
        has_app_payment = session.exec(app_payment_exists).one()

        if has_app_payment:
            return PopupAccessResponse(
                allowed=True,
                source="payment",
            )

        # Direct-sale leg: payment via product snapshot → attendee with human_id
        direct_payment_exists = select(
            sa_exists()
            .where(Payments.popup_id == popup_id)
            .where(Payments.application_id.is_(None))  # type: ignore[union-attr]
            .where(
                Payments.id.in_(  # type: ignore[union-attr]
                    select(PaymentProducts.payment_id)
                    .join(Attendees, PaymentProducts.attendee_id == Attendees.id)
                    .where(
                        Attendees.human_id == human_id,
                        Attendees.popup_id == popup_id,
                        Attendees.application_id.is_(None),  # type: ignore[union-attr]
                    )
                )
            )
        )
        has_direct_payment = session.exec(direct_payment_exists).one()

        if has_direct_payment:
            return PopupAccessResponse(
                allowed=True,
                source="payment",
            )

        # ---- Step 6: Companion check ----
        companion = attendees_crud.find_companion_for_popup(session, human_id, popup_id)

        if companion is not None:
            return PopupAccessResponse(
                allowed=True,
                source="companion",
            )

        # ---- Step 7: No match ----
        return PopupAccessResponse(
            allowed=False,
            reason="no_access",
        )


applications_crud = ApplicationsCRUD()
