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


class CheckoutMode(StrEnum):
    pass_system = "pass_system"
    simple_quantity = "simple_quantity"


class ApplicationLayout(StrEnum):
    """How the portal renders the application form for a popup.

    - single_page: all sections stacked on one page (legacy behavior).
    - multi_step: one section per step, with Next/Back navigation.
    """

    single_page = "single_page"
    multi_step = "multi_step"


def derive_checkout_mode(sale_type: SaleType) -> CheckoutMode:
    if sale_type == SaleType.direct:
        return CheckoutMode.simple_quantity

    return CheckoutMode.pass_system
