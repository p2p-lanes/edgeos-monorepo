from io import BytesIO

from openpyxl import load_workbook

from app.api.custom_export.schemas import CustomExportSpec
from app.api.custom_export.service import (
    _csv_bytes,
    _normalize_spec,
    _xlsx_bytes,
    export_catalog,
)


def test_custom_export_catalog_covers_initial_datasets_and_formats() -> None:
    catalog = export_catalog()

    assert {dataset.dataset for dataset in catalog.datasets} == {
        "applications",
        "attendees",
        "payments",
        "humans",
        "products",
        "tickets",
    }
    assert {format_.value for format_ in catalog.formats} == {"csv", "xlsx"}
    assert catalog.limits["max_rows"] == 50_000


def test_export_filename_does_not_duplicate_the_format_extension() -> None:
    spec = CustomExportSpec.model_validate(
        {
            "dataset": "applications",
            "popup_id": "11111111-1111-4111-8111-111111111111",
            "columns": [{"field": "application.id"}],
            "format": "xlsx",
            "filename": "applications-summaryxlsx",
        }
    )

    normalized, _dataset, _fields = _normalize_spec(spec)
    assert normalized.filename == "applications-summary"


def test_csv_and_xlsx_neutralize_spreadsheet_formulas() -> None:
    csv_content = _csv_bytes(["Name"], [["=2+2"], ["Ada"]])
    assert csv_content.startswith(b"\xef\xbb\xbf")
    assert b"'=2+2" in csv_content

    workbook = load_workbook(
        BytesIO(_xlsx_bytes(["Name"], [["=2+2"], ["Ada"]])),
        read_only=True,
        data_only=False,
    )
    values = list(workbook["Export"].values)
    assert values == [("Name",), ("'=2+2",), ("Ada",)]
