from enum import Enum, StrEnum


class UserRole(str, Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    VIEWER = "viewer"


class CredentialType(str, Enum):
    CRUD = "crud"
    READONLY = "readonly"


class SaleType(StrEnum):
    """Popup sale model.

    - application: traditional application-based flow (approval required).
    - direct: direct purchase by a logged-in Human, no application.
    Enum is extensible for future types (e.g. waitlist, lottery, registration).
    """

    application = "application"
    direct = "direct"
