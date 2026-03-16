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
        self, session: Session, label: str, popup_id: uuid.UUID
    ) -> str:
        """Generate a unique field name from a label."""
        base = _slugify(label)
        name = base
        counter = 1
        while self.get_by_name(session, name, popup_id):
            name = f"{base}_{counter}"
            counter += 1
        return name

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

    def validate_custom_fields(
        self,
        session: Session,
        popup_id: uuid.UUID,
        custom_fields: dict[str, Any] | None,
    ) -> tuple[bool, list[str]]:
        """Validate custom_fields against form field definitions.

        Returns tuple of (is_valid, list_of_errors).
        """
        if custom_fields is None:
            custom_fields = {}

        # Get all form fields for this popup
        fields, _ = self.find_by_popup(session, popup_id, skip=0, limit=1000)
        field_map = {f.name: f for f in fields}

        errors: list[str] = []

        # Check required fields
        for field in fields:
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
                if field.required:
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

            elif field_type == FormFieldType.EMAIL.value:
                if isinstance(value, str) and "@" not in value:
                    errors.append(f"Field '{field.label}' must be a valid email")

            elif field_type == FormFieldType.URL.value:
                if isinstance(value, str) and not (
                    value.startswith("http://") or value.startswith("https://")
                ):
                    errors.append(f"Field '{field.label}' must be a valid URL")

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

        db_sections, _ = form_sections_crud.find_by_popup(
            session, popup_id, skip=0, limit=100
        )

        # Load base field configs from DB
        from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
        from app.api.base_field_config.crud import base_field_configs_crud

        db_configs = base_field_configs_crud.find_by_popup(session, popup_id)
        config_map = {c.field_name: c for c in db_configs}

        # Determine which companion fields to include based on popup settings
        spouse_fields = {"partner", "partner_email"}
        children_fields = {"kids"}
        scholarship_fields = {"scholarship_request", "scholarship_details", "scholarship_video_url"}
        skip_fields: set[str] = set()
        if popup and not popup.allows_spouse:
            skip_fields |= spouse_fields
        if popup and not popup.allows_children:
            skip_fields |= children_fields
        if not getattr(popup, "allows_scholarship", False):
            skip_fields |= scholarship_fields

        # Build base fields by merging hardcoded definitions with DB configs
        base_fields: dict[str, Any] = {}
        for field_name, definition in BASE_FIELD_DEFINITIONS.items():
            if field_name in skip_fields:
                continue
            entry: dict[str, Any] = {
                "type": definition["type"],
                "label": definition["label"],
                "required": definition["required"],
                "target": definition["target"],
            }

            # Merge configurable attrs from DB config or fall back to defaults
            config = config_map.get(field_name)
            if config:
                entry["section_id"] = (
                    str(config.section_id) if config.section_id else None
                )
                entry["position"] = config.position
                if config.options:
                    entry["options"] = config.options
                if config.placeholder:
                    entry["placeholder"] = config.placeholder
                if config.help_text:
                    entry["help_text"] = config.help_text.replace(
                        "{popup_name}", popup_name
                    )
            else:
                # Fallback for old popups without configs
                entry["section_id"] = None
                entry["position"] = definition.get("default_position", 0)
                default_options = definition.get("default_options")
                if default_options:
                    entry["options"] = default_options
                default_placeholder = definition.get("default_placeholder")
                if default_placeholder:
                    entry["placeholder"] = default_placeholder
                default_help_text = definition.get("default_help_text")
                if default_help_text:
                    entry["help_text"] = default_help_text.replace(
                        "{popup_name}", popup_name
                    )

            base_fields[field_name] = entry

        # Build custom fields schema
        custom_fields = {}
        for field in fields:
            custom_entry: dict[str, Any] = {
                "type": field.field_type,
                "label": field.label,
                "required": field.required,
                "section_id": str(field.section_id) if field.section_id else None,
                "position": field.position,
            }
            if field.options:
                custom_entry["options"] = field.options
            if field.placeholder:
                custom_entry["placeholder"] = field.placeholder
            if field.help_text:
                custom_entry["help_text"] = field.help_text
            custom_fields[field.name] = custom_entry

        # Build sections list from DB
        sections = [
            {
                "id": str(s.id),
                "label": s.label,
                "description": s.description,
                "order": s.order,
            }
            for s in db_sections
        ]

        return {
            "base_fields": base_fields,
            "custom_fields": custom_fields,
            "sections": sections,
        }


form_fields_crud = FormFieldsCRUD()
