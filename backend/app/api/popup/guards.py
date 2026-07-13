"""Write guards shared by popup-scoped portal endpoints.

Lives in the popup package (not ``core``) so routers can import it without
pulling API modules into ``app.core.security``.
"""

from fastapi import HTTPException, status

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus


def ensure_popup_writable(popup: Popups | None) -> None:
    """Reject portal mutations on ended popups (recap mode is read-only).

    Applies to both portal JWT humans and API-key callers, which share the
    same ``/portal`` endpoints. Backoffice/admin endpoints stay writable.
    """
    if popup is not None and popup.status == PopupStatus.ended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This popup has ended and is read-only.",
        )
