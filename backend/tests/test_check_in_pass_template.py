"""Contract tests for the CHECK_IN_PASS email template type."""

from app.api.email_template.schemas import EmailTemplateType, TemplateScope
from app.services.email.templates import (
    TEMPLATE_TYPE_METADATA,
    TEMPLATE_TYPE_TO_FILE,
    CheckInPassContext,
    CheckInQrItem,
    flatten_template,
    is_customizable_template_type,
)


def _check_in_pass_meta() -> dict:
    return next(
        meta
        for meta in TEMPLATE_TYPE_METADATA
        if meta["type"] == EmailTemplateType.CHECK_IN_PASS
    )


def test_check_in_pass_is_popup_scoped_and_customizable() -> None:
    meta = _check_in_pass_meta()
    assert meta["scope"] == TemplateScope.POPUP
    assert is_customizable_template_type(EmailTemplateType.CHECK_IN_PASS)
    assert EmailTemplateType.CHECK_IN_PASS in TEMPLATE_TYPE_TO_FILE


def test_check_in_pass_metadata_exposes_qr_variables() -> None:
    variable_names = {var["name"] for var in _check_in_pass_meta()["variables"]}
    assert "checkin_qrs" in variable_names
    assert "checkin_qr_url" in variable_names
    assert "first_name" in variable_names


def test_check_in_pass_context_fields() -> None:
    fields = CheckInPassContext.model_fields
    assert "checkin_qrs" in fields
    assert "checkin_qr_url" in fields
    assert "first_name" in fields
    assert "popup_name" in fields
    assert "portal_url" in fields


def test_check_in_qr_item_fields() -> None:
    item = CheckInQrItem(
        attendee_name="Ada Lovelace",
        product_name="Full Pass",
        check_in_code="ABCDEFGH",
        qr_url="https://cdn.example.com/checkin-qr/abc.png",
    )
    assert item.qr_url is not None
    # qr_url is optional (storage may be unavailable at build time)
    assert (
        CheckInQrItem(attendee_name="x", product_name="y", check_in_code="z").qr_url
        is None
    )


def test_flatten_check_in_pass_preserves_qr_loop() -> None:
    # The default is self-contained, so flatten returns it verbatim — the
    # editor's "Load default" must keep the per-ticket QR loop (a rendered
    # flatten would execute the loop over no data and drop it).
    html = flatten_template(EmailTemplateType.CHECK_IN_PASS)
    assert html.strip()
    assert "{{ popup_name }}" in html
    assert "{{ first_name }}" in html
    assert "{% for qr in checkin_qrs %}" in html
    assert "{{ qr.qr_url }}" in html
    assert "<img" in html


def test_default_template_renders_qr_images_from_sample_vars() -> None:
    # The default template loops over checkin_qrs; with sample preview vars it
    # should render an <img> per ticket plus the attendee names.
    from app.services.checkin_qr import sample_checkin_pass_preview_vars
    from app.services.email import get_email_service

    context = {
        "first_name": "Alex",
        "popup_name": "Edge Esmeralda",
        **sample_checkin_pass_preview_vars(),
    }
    html = get_email_service().render_template("check_in/pass.html", context)
    assert "data:image/png;base64," in html
    assert "Alex Rivera" in html
    assert "Sam Lee" in html
