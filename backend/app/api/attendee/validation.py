from datetime import date

from fastapi import HTTPException, status


def validate_required_fields(
    required_fields: list[dict],
    additional_data: dict,
) -> None:
    """Validate declarative attendee fields with the shared API semantics."""
    data = additional_data or {}
    for field in required_fields or []:
        name = field.get("name")
        if not name:
            continue
        value = data.get(name)
        if field.get("required") and (value is None or value == ""):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[
                    {
                        "code": "required_field_missing",
                        "field": name,
                        "message": f"Missing required field '{name}'",
                    }
                ],
            )
        if field.get("type") == "date" and value not in (None, ""):
            try:
                date.fromisoformat(str(value))
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=[
                        {
                            "code": "invalid_date",
                            "field": name,
                            "message": (
                                f"Field '{name}' must be an ISO date (YYYY-MM-DD)"
                            ),
                        }
                    ],
                ) from None
