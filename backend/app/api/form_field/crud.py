import re
import unicodedata
import uuid
from typing import Any

from sqlalchemy import or_
from sqlmodel import Session, col, func, select

from app.api.form_field.models import FormFields
from app.api.form_field.schemas import FormFieldCreate, FormFieldType, FormFieldUpdate
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.shared.crud import BaseCRUD


def _slugify(text: str) -> str:
    """Convert text to a slug suitable for use as a field name."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s]", "", text.lower())
    text = re.sub(r"[\s]+", "_", text).strip("_")
    return text[:80] or "field"


# Mirrors the portal `CHECKOUT_BASE_FIELD_KEYS` set in
# portal/src/app/checkout/types.ts. The /groups Express Checkout renders only
# base fields in this set OR whose target is "human", plus custom fields that
# share a section with those base fields. Required validation must use the
# same subset so backend doesn't reject what the form never asked for.
EXPRESS_CHECKOUT_BASE_FIELD_NAMES = frozenset(
    {
        "email",
        "first_name",
        "last_name",
        "telegram",
        "gender",
        "age",
        "residence",
    }
)


def _is_express_checkout_base_field(
    field_name: str, definition: dict[str, Any]
) -> bool:
    if field_name in EXPRESS_CHECKOUT_BASE_FIELD_NAMES:
        return True
    return definition.get("target") == "human"


_EXPRESS_UNSECTIONED_KEY = "__express_unsectioned__"


def _section_key(section_id: uuid.UUID | None) -> str:
    return str(section_id) if section_id else _EXPRESS_UNSECTIONED_KEY


class FormFieldsCRUD(BaseCRUD[FormFields, FormFieldCreate, FormFieldUpdate]):
    def __init__(self) -> None:
        super().__init__(FormFields)

    def get_by_name(
        self, session: Session, name: str, popup_id: uuid.UUID
    ) -> FormFields | None:
        statement = select(FormFields).where(
            FormFields.name == name, FormFields.popup_id == popup_id
        )
        return session.exec(statement).first()

    def generate_field_name(
        self,
        session: Session,
        label: str,
        popup_id: uuid.UUID,
        exclude_id: uuid.UUID | None = None,
    ) -> str:
        """Generate a unique field name from a label.

        ``exclude_id`` skips a field's own row in the collision check so a
        rename can't be suffixed against itself.
        """
        base = _slugify(label)
        name = base
        counter = 1
        while True:
            existing = self.get_by_name(session, name, popup_id)
            if existing is None or existing.id == exclude_id:
                return name
            name = f"{base}_{counter}"
            counter += 1

    def is_field_name_in_use(
        self, session: Session, name: str, popup_id: uuid.UUID
    ) -> bool:
        """Return True if submitted data or config references this field name.

        Checks application custom_fields (and their snapshots) plus ticketing
        step section visibility conditions. Once any of these reference the
        name, renaming it would orphan data, so the key must stay frozen.
        """
        from app.api.application.models import Applications, ApplicationSnapshots
        from app.api.ticketing_step.crud import ticketing_steps_crud

        app_stmt = (
            select(Applications.id)
            .where(
                Applications.popup_id == popup_id,
                col(Applications.custom_fields).has_key(name),
            )
            .limit(1)
        )
        if session.exec(app_stmt).first() is not None:
            return True

        snapshot_stmt = (
            select(ApplicationSnapshots.id)
            .join(
                Applications,
                col(ApplicationSnapshots.application_id) == col(Applications.id),
            )
            .where(
                Applications.popup_id == popup_id,
                col(ApplicationSnapshots.custom_fields).has_key(name),
            )
            .limit(1)
        )
        if session.exec(snapshot_stmt).first() is not None:
            return True

        steps, _ = ticketing_steps_crud.find_by_popup(session, popup_id, limit=1000)
        for step in steps:
            sections = (step.template_config or {}).get("sections", [])
            for section in sections:
                if not isinstance(section, dict):
                    continue
                visible_if = section.get("visible_if")
                if isinstance(visible_if, dict) and visible_if.get("field_id") == name:
                    return True

        return False

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
    ) -> tuple[list[FormFields], int]:
        statement = (
            select(FormFields)
            .outerjoin(FormSections, FormFields.section_id == FormSections.id)
            .where(FormFields.popup_id == popup_id)
            .order_by(FormSections.order, FormFields.position)  # type: ignore[arg-type]
        )

        # Apply text search if provided
        if search:
            search_term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(FormFields.label).ilike(search_term),
                    col(FormFields.name).ilike(search_term),
                    col(FormFields.field_type).ilike(search_term),
                )
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def validate_base_fields(
        self,
        session: Session,
        popup_id: uuid.UUID,
        app_data: dict[str, Any],
        human: Any,
        is_express_checkout: bool = False,
    ) -> tuple[bool, list[str]]:
        """Validate required base fields are present.

        For fields with target=human, a value already stored on the Human
        satisfies the requirement (so humans that filled the field in a prior
        application don't have to retype it).

        Elementals (first_name, last_name) are skipped here because Pydantic
        enforces them at the ApplicationCreate layer.

        When ``is_express_checkout`` is True, required checks are limited to
        the reduced subset rendered by the portal /groups Express Checkout
        (mirrors ``isCheckoutBaseField`` in portal/src/app/checkout/types.ts).
        """
        from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
        from app.api.base_field_config.crud import base_field_configs_crud
        from app.api.form_section.crud import form_sections_crud

        configs = base_field_configs_crud.find_by_popup(session, popup_id)
        sections, _ = form_sections_crud.find_by_popup(session, popup_id, limit=None)
        hidden_section_ids = {s.id for s in sections if s.hidden}
        errors: list[str] = []

        for config in configs:
            if not config.required:
                continue
            definition = BASE_FIELD_DEFINITIONS.get(config.field_name)
            if not definition:
                continue
            if not definition.get("removable", True):
                continue
            if config.section_id and config.section_id in hidden_section_ids:
                continue
            if is_express_checkout and not _is_express_checkout_base_field(
                config.field_name, definition
            ):
                continue

            field_name = config.field_name
            value = app_data.get(field_name)
            if (
                (value is None or value == "")
                and definition["target"] == "human"
                and human is not None
            ):
                value = getattr(human, field_name, None)

            if value is None or value == "":
                label = config.label or definition["label"]
                errors.append(f"Required field '{label}' is missing")

        return len(errors) == 0, errors

    def validate_custom_fields(
        self,
        session: Session,
        popup_id: uuid.UUID,
        custom_fields: dict[str, Any] | None,
        skip_required: bool = False,
        is_express_checkout: bool = False,
    ) -> tuple[bool, list[str]]:
        """Validate custom_fields against form field definitions.

        When ``skip_required`` is True, presence/emptiness checks on required
        fields are bypassed (used for draft saves), but type and constraint
        validation still runs on whatever values were provided.

        When ``is_express_checkout`` is True, required checks are limited to
        custom fields whose section also contains an Express Checkout base
        field (mirrors ``getCheckoutMiniFormSchema`` in the portal).

        Returns tuple of (is_valid, list_of_errors).
        """
        if custom_fields is None:
            custom_fields = {}

        # Get all form fields for this popup
        fields, _ = self.find_by_popup(session, popup_id, skip=0, limit=1000)
        field_map = {f.name: f for f in fields}

        # Hidden sections aren't asked on the portal, so skip required-field
        # validation for fields belonging to them.
        from app.api.form_section.crud import form_sections_crud

        sections, _ = form_sections_crud.find_by_popup(session, popup_id, limit=None)
        hidden_section_ids = {s.id for s in sections if s.hidden}

        # When the request comes from the /groups Express Checkout, only
        # custom fields sharing a section with an Express Checkout base field
        # were rendered — restrict required validation to that subset.
        express_section_keys: set[str] = set()
        if is_express_checkout:
            from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
            from app.api.base_field_config.crud import base_field_configs_crud

            base_configs = base_field_configs_crud.find_by_popup(session, popup_id)
            for config in base_configs:
                definition = BASE_FIELD_DEFINITIONS.get(config.field_name)
                if not definition:
                    continue
                if _is_express_checkout_base_field(config.field_name, definition):
                    express_section_keys.add(_section_key(config.section_id))

        errors: list[str] = []

        # Check required fields
        if not skip_required:
            for field in fields:
                if field.section_id and field.section_id in hidden_section_ids:
                    continue
                if (
                    is_express_checkout
                    and _section_key(field.section_id) not in express_section_keys
                ):
                    continue
                if field.required and field.name not in custom_fields:
                    errors.append(f"Required field '{field.label}' is missing")

        # Validate provided values
        for field_name, value in custom_fields.items():
            if field_name not in field_map:
                # Unknown field - could be from an old schema, skip validation
                continue

            field = field_map[field_name]

            # Skip validation for None/empty values on non-required fields
            if value is None or value == "":
                if field.required and not skip_required:
                    errors.append(f"Required field '{field.label}' cannot be empty")
                continue

            # Type-specific validation
            field_type = field.field_type

            if field_type == FormFieldType.NUMBER.value:
                if not isinstance(value, int | float):
                    try:
                        float(value)
                    except (ValueError, TypeError):
                        errors.append(f"Field '{field.label}' must be a number")

            elif field_type == FormFieldType.BOOLEAN.value:
                if not isinstance(value, bool):
                    errors.append(f"Field '{field.label}' must be a boolean")

            elif field_type == FormFieldType.SELECT.value:
                if field.options and value not in field.options:
                    errors.append(
                        f"Field '{field.label}' must be one of: {', '.join(field.options)}"
                    )

            elif field_type == FormFieldType.SELECT_CARDS.value:
                if field.options and value not in field.options:
                    errors.append(
                        f"Field '{field.label}' must be one of: {', '.join(field.options)}"
                    )

            elif field_type == FormFieldType.MULTISELECT.value:
                if not isinstance(value, list):
                    errors.append(f"Field '{field.label}' must be a list")
                elif field.options:
                    invalid = [v for v in value if v not in field.options]
                    if invalid:
                        errors.append(
                            f"Field '{field.label}' contains invalid options: {', '.join(invalid)}"
                        )

            elif field_type == FormFieldType.RADIO.value:
                if field.options and value not in field.options:
                    errors.append(
                        f"Field '{field.label}' must be one of: {', '.join(field.options)}"
                    )

            elif field_type == FormFieldType.MULTISELECT_DETAILED.value:
                if not isinstance(value, list):
                    errors.append(f"Field '{field.label}' must be a list")
                else:
                    if field.options:
                        invalid = [v for v in value if v not in field.options]
                        if invalid:
                            errors.append(
                                f"Field '{field.label}' contains invalid options: {', '.join(invalid)}"
                            )
                    cfg = field.config or {}
                    min_sel = cfg.get("min_selections")
                    max_sel = cfg.get("max_selections")
                    if isinstance(min_sel, int) and len(value) < min_sel:
                        errors.append(
                            f"Field '{field.label}' requires at least {min_sel} selection(s)"
                        )
                    if isinstance(max_sel, int) and len(value) > max_sel:
                        errors.append(
                            f"Field '{field.label}' allows at most {max_sel} selection(s)"
                        )

            elif field_type == FormFieldType.EMAIL.value:
                if isinstance(value, str) and "@" not in value:
                    errors.append(f"Field '{field.label}' must be a valid email")

            elif field_type == FormFieldType.URL.value:
                if isinstance(value, str) and not (
                    value.startswith("http://") or value.startswith("https://")
                ):
                    errors.append(f"Field '{field.label}' must be a valid URL")

            elif field_type == FormFieldType.DATE.value:
                if isinstance(value, str) and value:
                    min_d = field.min_date
                    max_d = field.max_date
                    if min_d and value < min_d:
                        errors.append(
                            f"'{field.label}': date must be on or after {min_d}"
                        )
                    if max_d and value > max_d:
                        errors.append(
                            f"'{field.label}': date must be on or before {max_d}"
                        )

        return len(errors) == 0, errors

    def build_schema_for_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> dict[str, Any]:
        """Build a JSON Schema-like structure for a popup's form fields.

        This returns a schema that includes:
        - Base fields: human profile + application-level fields (source of truth)
        - Custom form fields defined for the popup
        Each base field includes a `target` indicating where the data lives:
        - "human": stored on the Human entity
        - "application": stored on the Application entity
        """
        fields, _ = self.find_by_popup(session, popup_id, skip=0, limit=1000)

        # Load popup for interpolating help_text
        popup = session.get(Popups, popup_id)
        popup_name = popup.name if popup else "the event"

        # Load sections for this popup
        from app.api.form_section.crud import form_sections_crud

        db_sections, _ = form_sections_crud.find_by_popup(session, popup_id, limit=None)

        # Hidden sections are dropped from the schema entirely (and so are
        # their fields). The data + section row stay in the DB so the admin
        # can switch them back on without losing configuration.
        hidden_section_ids = {s.id for s in db_sections if s.hidden}
        visible_sections = [s for s in db_sections if not s.hidden]

        # Base fields are driven 100% by BaseFieldConfigs rows: if a config
        # exists for this popup, the field is asked. The catalog is only
        # consulted for non-configurable code-level properties (type, target).
        from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
        from app.api.base_field_config.crud import (
            base_field_configs_crud,
            field_applies_to_popup,
        )

        db_configs = base_field_configs_crud.find_by_popup(session, popup_id)

        base_fields: dict[str, Any] = {}
        for config in db_configs:
            definition = BASE_FIELD_DEFINITIONS.get(config.field_name)
            if not definition:
                # Config references a field no longer in the catalog.
                continue
            # Gate by current popup flags: configs persist when an admin turns
            # a flag off, but we stop surfacing them until it's re-enabled.
            # Sections left empty by this filter are skipped by the portal
            # (it drops sections with no base/custom fields).
            if popup and not field_applies_to_popup(config.field_name, popup):
                continue
            if config.section_id and config.section_id in hidden_section_ids:
                continue
            entry: dict[str, Any] = {
                "type": config.field_type or definition["type"],
                "target": definition["target"],
                "label": config.label or "",
                "required": config.required,
                "section_id": str(config.section_id) if config.section_id else None,
                "position": config.position,
            }
            if config.options:
                entry["options"] = config.options
            if config.placeholder:
                entry["placeholder"] = config.placeholder
            if config.help_text:
                entry["help_text"] = config.help_text.replace(
                    "{popup_name}", popup_name
                )
            base_fields[config.field_name] = entry

        # Build custom fields schema
        custom_fields = {}
        for field in fields:
            if field.section_id and field.section_id in hidden_section_ids:
                continue
            custom_entry: dict[str, Any] = {
                "type": field.field_type,
                "label": field.label,
                "required": field.required,
                "section_id": str(field.section_id) if field.section_id else None,
                "position": field.position,
                "min_date": field.min_date,
                "max_date": field.max_date,
            }
            if field.options:
                custom_entry["options"] = field.options
            if field.placeholder:
                custom_entry["placeholder"] = field.placeholder
            if field.help_text:
                custom_entry["help_text"] = field.help_text
            if field.config:
                custom_entry["config"] = field.config
            if field.width:
                custom_entry["width"] = field.width
            custom_fields[field.name] = custom_entry

        # Build sections list from DB (visible only — hidden sections are
        # not surfaced to the consumer).
        sections = [
            {
                "id": str(s.id),
                "label": s.label,
                "description": s.description,
                "order": s.order,
                "kind": s.kind,
            }
            for s in visible_sections
        ]

        return {
            "base_fields": base_fields,
            "custom_fields": custom_fields,
            "sections": sections,
        }


form_fields_crud = FormFieldsCRUD()
