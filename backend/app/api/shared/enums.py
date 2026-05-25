from enum import Enum, StrEnum


class UserRole(str, Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"
    CHECK_IN_CONTROLLER = "check_in_controller"


class CredentialType(str, Enum):
    CRUD = "crud"
    READONLY = "readonly"


class LandingMode(StrEnum):
    """Per-tenant landing mode for custom domains.

    - portal: standard portal experience (default for all tenants).
    - checkout: custom domain opens the active direct-sale popup checkout directly.
    Extensible for future modes (e.g. splash, events) without schema changes.
    """

    portal = "portal"
    checkout = "checkout"


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


class InstallmentInterval(StrEnum):
    """Billing interval for installment plans (mirrors SimpleFi's InstallmentInterval)."""

    day = "day"
    week = "week"
    month = "month"
    year = "year"


def derive_checkout_mode(sale_type: SaleType) -> CheckoutMode:
    if sale_type == SaleType.direct:
        return CheckoutMode.simple_quantity

    return CheckoutMode.pass_system
