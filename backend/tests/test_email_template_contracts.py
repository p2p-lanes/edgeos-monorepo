import pytest

from app.api.email_template.schemas import EmailTemplateType
from app.services.email.templates import (
    TEMPLATE_TYPE_METADATA,
    ApplicationAcceptedContext,
    flatten_template,
    get_template_scope,
)


@pytest.mark.parametrize("metadata", TEMPLATE_TYPE_METADATA, ids=lambda m: m["type"])
def test_editor_scope_matches_template_resolution_scope(metadata) -> None:
    """The editor must look in the same tier as the sender for saved templates."""
    assert metadata["scope"] == get_template_scope(metadata["type"])


def test_application_accepted_context_does_not_expose_unsupported_fields() -> None:
    assert "payment_deadline" not in ApplicationAcceptedContext.model_fields
    assert "discount_assigned" not in ApplicationAcceptedContext.model_fields


def test_application_accepted_metadata_does_not_advertise_unsupported_variables() -> (
    None
):
    accepted_meta = next(
        meta
        for meta in TEMPLATE_TYPE_METADATA
        if meta["type"] == EmailTemplateType.APPLICATION_ACCEPTED
    )

    variable_names = {variable["name"] for variable in accepted_meta["variables"]}

    assert "payment_deadline" not in variable_names
    assert "discount_assigned" not in variable_names


def test_flattened_application_accepted_template_does_not_reference_removed_variables() -> (
    None
):
    html = flatten_template(EmailTemplateType.APPLICATION_ACCEPTED)

    assert "payment_deadline" not in html
    assert "discount_assigned" not in html
