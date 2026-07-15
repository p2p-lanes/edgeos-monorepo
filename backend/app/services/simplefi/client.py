import urllib.parse
from decimal import Decimal
from enum import StrEnum
from typing import Any

import httpx
from loguru import logger
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings

# ---------------------------------------------------------------------------
# Cancel outcome helpers (ADR-3)
# ---------------------------------------------------------------------------

# SimpleFi uses "canceled" (one L) for payment_requests and "cancelled" (two L)
# for installment_plans. Both spellings are accepted throughout this module.
TERMINAL_CANCEL_STATUSES: frozenset[str] = frozenset(
    {"canceled", "cancelled", "expired", "refunded"}
)
APPROVED_STATUSES: frozenset[str] = frozenset({"approved", "active", "completed"})


class CancelOutcome(StrEnum):
    """Result of a SimpleFi cancel call, used by supersede and sweeper logic."""

    CANCELED = "canceled"
    ALREADY_APPROVED = "already_approved"


class CancelOutcomeAmbiguousError(Exception):
    """Raised when a cancel response cannot be classified as a definitive outcome.

    Callers MUST treat this exception as 'do not release holds' — the resource
    is in an indeterminate state (e.g. still 'pending', empty, or unknown status)
    and releasing holds would risk a double-spend.
    """


def _normalize_cancel_status(status: str) -> str:
    """Return the status string lowercased and stripped for classification."""
    return status.lower().strip()


class SimpleFIPaymentResponse(BaseModel):
    """Response from SimpleFI payment creation.

    `id` is the external identifier we store in ``payments.external_id`` —
    a payment_request_id for one-shot requests, or an installment_plan_id
    when ``is_installment_plan`` is True. Both kinds are looked up the same
    way by webhook handlers.
    """

    id: str
    status: str
    checkout_url: str
    is_installment_plan: bool = False


class SimpleFIPaymentRequestStatus(BaseModel):
    """Minimal payment request status payload."""

    id: str
    status: str


class SimpleFIClient:
    """Client for interacting with SimpleFI payment API."""

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.base_url = settings.SIMPLEFI_API_URL
        self.timeout = 20.0

    @staticmethod
    def _build_tenant_portal_url(tenant_slug: str) -> str:
        """Build tenant-specific portal URL by prepending tenant slug as subdomain.

        Example: https://edge.muvin.co -> https://tenant-slug.edge.muvin.co
        For localhost: http://localhost:3000 -> http://tenant-slug.localhost:3000
        """
        parsed = urllib.parse.urlparse(settings.PORTAL_URL)
        tenant_host = f"{tenant_slug}.{parsed.hostname}"
        if parsed.port:
            tenant_host = f"{tenant_host}:{parsed.port}"
        return f"{parsed.scheme}://{tenant_host}"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        before=lambda retry_state: logger.warning(
            "Starting call to '{}', attempt #{}",
            retry_state.fn.__name__,
            retry_state.attempt_number,
        ),
        after=lambda retry_state: logger.warning(
            "Finished call to '{}' after {} attempt(s)",
            retry_state.fn.__name__,
            retry_state.attempt_number,
        ),
    )
    def _make_request(
        self,
        method: str,
        endpoint: str,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make an HTTP request to SimpleFI API with retry logic."""
        url = f"{self.base_url}{endpoint}"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(method, url, json=json, headers=headers)
            logger.info(
                "SimpleFI API response status: {}, body: {}",
                response.status_code,
                response.text,
            )
            response.raise_for_status()
            return response.json()

    def create_payment(
        self,
        amount: Decimal,
        popup_slug: str,
        tenant_slug: str,
        currency: str = "USD",
        reference: dict[str, Any] | None = None,
        memo: str = "EdgeOS Payment",
        portal_base_override: str | None = None,
        success_path: str | None = None,
        cancel_path: str | None = None,
        max_installments: int | None = None,
        installment_interval: str = "month",
        installment_interval_count: int = 1,
        user_email: str | None = None,
        plan_name: str | None = None,
        success_behavior: str = "manual",
    ) -> SimpleFIPaymentResponse:
        """
        Create a payment request OR an installment plan in SimpleFI.

        When ``max_installments`` is None or < 2 (the default), this hits
        ``POST /payment_requests`` exactly as before. When ``max_installments``
        is >= 2 this hits ``POST /installment_plans`` instead: the plan is
        created in ``pending`` status and the buyer picks the actual number
        of installments on SimpleFi's checkout UI; activation fires our
        ``installment_plan_activated`` webhook.

        Both modes return a uniform ``SimpleFIPaymentResponse`` — ``id`` is
        either a payment_request_id (one-shot) or an installment_plan_id
        (installments). ``is_installment_plan`` tells callers which path ran.

        Args:
            amount: The payment amount
            popup_slug: The popup slug for building portal redirect URLs
            tenant_slug: The tenant slug for the portal subdomain (used as
                fallback when ``portal_base_override`` is not provided)
            currency: The payment currency code (e.g. USD, ARS, EUR)
            reference: Optional reference data (application_id, email, products)
            portal_base_override: If provided, used as the portal base URL
                instead of the default subdomain derivation.  Pass
                ``get_portal_url(tenant)`` from callers that have a Tenant
                object to respect active custom domains.
            success_path: Full URL override for the success redirect. When
                provided, overrides the default passes/buy?checkout=success path.
            cancel_path: Full URL override for the cancel redirect. When
                provided, overrides the default passes/buy path.
            max_installments: Ceiling of installments offered to the buyer.
                If None or < 2, a one-shot payment_request is created instead.
            installment_interval: One of "day" | "week" | "month" | "year".
            installment_interval_count: Multiplier on the interval (e.g.
                interval="week", interval_count=2 → bi-weekly).
            user_email: Required when creating an installment plan.
            plan_name: Optional display name for the installment plan
                (shown to the buyer in SimpleFi's UI).
            success_behavior: "manual" (SimpleFi's default — the buyer clicks
                through to the success URL) or "automatic" (SimpleFi redirects
                immediately after approval).

        Returns:
            SimpleFIPaymentResponse with id, status, checkout_url, and
            is_installment_plan flag.
        """
        notification_url = urllib.parse.urljoin(
            settings.BACKEND_URL, "/api/v1/payments/webhook/simplefi"
        )

        portal_base = portal_base_override or self._build_tenant_portal_url(tenant_slug)
        success_url = (
            success_path
            or f"{portal_base}/portal/{popup_slug}/passes/buy?checkout=success"
        )
        cancel_url = cancel_path or f"{portal_base}/portal/{popup_slug}/passes/buy"
        redirect_urls = {
            "success_url": success_url,
            "cancel_url": cancel_url,
            "success_behavior": success_behavior,
        }

        if max_installments is not None and max_installments >= 2:
            if not user_email:
                raise ValueError(
                    "user_email is required when creating an installment plan"
                )
            return self._create_installment_plan(
                amount=amount,
                currency=currency,
                max_installments=max_installments,
                interval=installment_interval,
                interval_count=installment_interval_count,
                user_email=user_email,
                plan_name=plan_name,
                reference=reference,
                notification_url=notification_url,
                redirect_urls=redirect_urls,
                popup_slug=popup_slug,
                tenant_slug=tenant_slug,
            )

        body = {
            "amount": float(amount),
            "currency": currency,
            "reference": reference or {},
            "memo": memo,
            "notification_url": notification_url,
            "redirect_urls": redirect_urls,
        }

        logger.info(
            "SimpleFI create payment request: amount={} currency={} popup_slug={} tenant_slug={} memo={} reference_keys={} success_url={} cancel_url={}",
            amount,
            currency,
            popup_slug,
            tenant_slug,
            memo,
            sorted(body["reference"].keys()),
            success_url,
            cancel_url,
        )
        data = self._make_request("POST", "/payment_requests", json=body)

        logger.info(
            "SimpleFI create payment parsed response: external_id={} status={} checkout_url={}",
            data.get("id"),
            data.get("status"),
            data.get("checkout_v2_url"),
        )

        return SimpleFIPaymentResponse(
            id=data["id"],
            status=data["status"],
            checkout_url=data["checkout_v2_url"],
            is_installment_plan=False,
        )

    def _create_installment_plan(
        self,
        *,
        amount: Decimal,
        currency: str,
        max_installments: int,
        interval: str,
        interval_count: int,
        user_email: str,
        plan_name: str | None,
        reference: dict[str, Any] | None,
        notification_url: str,
        redirect_urls: dict[str, str],
        popup_slug: str,
        tenant_slug: str,
    ) -> SimpleFIPaymentResponse:
        """POST to /installment_plans with the buyer-pickable ceiling.

        We send ``max_installments`` (not ``number_of_installments``) so SimpleFi
        creates the plan in ``pending`` status and renders the per-cycle
        selector to the buyer. Activation arrives later via the
        ``installment_plan_activated`` webhook.
        """
        body: dict[str, Any] = {
            "total_amount": float(amount),
            "currency": currency,
            "max_installments": max_installments,
            "interval": interval,
            "interval_count": interval_count,
            "user_email": user_email,
            "reference": reference or {},
            "notification_url": notification_url,
            "redirect_urls": redirect_urls,
        }
        if plan_name:
            body["name"] = plan_name

        logger.info(
            "SimpleFI create installment plan: amount={} currency={} max_installments={} interval={}x{} popup_slug={} tenant_slug={} reference_keys={}",
            amount,
            currency,
            max_installments,
            interval_count,
            interval,
            popup_slug,
            tenant_slug,
            sorted(body["reference"].keys()),
        )
        data = self._make_request("POST", "/installment_plans", json=body)

        logger.info(
            "SimpleFI installment plan response: external_id={} status={} checkout_url={}",
            data.get("id"),
            data.get("status"),
            data.get("checkout_url"),
        )

        return SimpleFIPaymentResponse(
            id=data["id"],
            status=data["status"],
            checkout_url=data["checkout_url"],
            is_installment_plan=True,
        )

    def get_payment_request_status(
        self, payment_request_id: str
    ) -> SimpleFIPaymentRequestStatus:
        """Fetch the latest status for an existing SimpleFI payment request."""

        data = self._make_request("GET", f"/payment_requests/{payment_request_id}")

        payload = data.get("payment_request", data)
        return SimpleFIPaymentRequestStatus(
            id=payload["id"],
            status=payload["status"],
        )

    # ------------------------------------------------------------------
    # Non-retrying request helper (ADR-3)
    # ------------------------------------------------------------------

    def _non_retrying_request(self, method: str, endpoint: str) -> httpx.Response:
        """Make a single HTTP request without the tenacity retry loop.

        Unlike ``_make_request``, this method:
        - Returns the raw ``httpx.Response`` so callers can inspect the status
          code before deciding how to classify the outcome.
        - Does NOT retry on ``HTTPStatusError`` or ``RequestError`` — a 4xx
          from a cancel call carries semantic meaning (already terminal) and
          must not be retried away.
        """
        url = f"{self.base_url}{endpoint}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(method, url, headers=headers)
        logger.info(
            "SimpleFI {} {} -> {}",
            method,
            url,
            response.status_code,
        )
        return response

    # ------------------------------------------------------------------
    # Outcome classifier (shared by both cancel methods)
    # ------------------------------------------------------------------

    def _non_retrying_get_status(
        self, endpoint: str, nested_key: str
    ) -> SimpleFIPaymentRequestStatus:
        """Fetch a resource's status with a SINGLE non-retrying GET attempt.

        Used as the 4xx-cancel fallback so the call remains bounded to one
        attempt instead of the retrying ``_make_request`` path (3 attempts,
        exponential back-off, up to ~30 s on a checkout-blocking call).

        On failure — transport error or any non-2xx response — the exception
        propagates directly.  Callers MUST treat any exception as
        'do not release holds'.

        Args:
            endpoint: GET endpoint, e.g. ``/payment_requests/{id}``.
            nested_key: Key used to unwrap a nested payload, e.g.
                ``"payment_request"`` or ``"installment_plan"``.
        """
        response = self._non_retrying_request("GET", endpoint)
        response.raise_for_status()
        data = response.json()
        payload = data.get(nested_key, data)
        return SimpleFIPaymentRequestStatus(
            id=payload["id"],
            status=payload["status"],
        )

    def _classify_cancel_status(
        self, status: str, resource_id: str, resource_type: str
    ) -> CancelOutcome:
        """Map a normalized SimpleFi status string to a ``CancelOutcome``.

        Raises ``CancelOutcomeAmbiguousError`` if the status cannot be
        classified (e.g. still 'pending', empty, or unknown after a cancel).
        Callers MUST treat it as 'do not release holds'.
        """
        normalized = _normalize_cancel_status(status)
        if normalized in TERMINAL_CANCEL_STATUSES:
            return CancelOutcome.CANCELED
        if normalized in APPROVED_STATUSES:
            return CancelOutcome.ALREADY_APPROVED
        raise CancelOutcomeAmbiguousError(
            f"Cannot classify {resource_type} {resource_id!r}: "
            f"unresolvable status={status!r}"
        )

    # ------------------------------------------------------------------
    # Cancel methods (ADR-3)
    # ------------------------------------------------------------------

    def cancel_payment_request(self, payment_id: str) -> CancelOutcome:
        """Cancel a SimpleFi payment_request without retrying.

        Outcome mapping (ADR-3):
        - 2xx with terminal status (canceled/cancelled/expired/refunded) → CANCELED
        - 2xx or 4xx with approved/active/completed → ALREADY_APPROVED
        - 2xx with unresolvable status (pending/empty/unknown) → raises
          ``CancelOutcomeAmbiguousError``; callers MUST not release holds
        - 4xx (already terminal) → single non-retrying re-read via
          ``_non_retrying_get_status`` to classify; on re-read failure the
          exception propagates (= do not release holds)
        - 5xx → raise ``HTTPStatusError``
        - Transport/timeout → raise ``RequestError``
        """
        response = self._non_retrying_request(
            "PUT", f"/payment_requests/{payment_id}/cancel"
        )

        if response.status_code < 400:
            data = response.json()
            status = data.get("status", "")
            return self._classify_cancel_status(status, payment_id, "payment_request")

        if response.status_code < 500:
            # 4xx: resource already in a terminal or approved state — re-read the
            # current status with a SINGLE non-retrying attempt so this
            # checkout-blocking path cannot stall for up to ~30 s under the
            # retrying _make_request path. On re-read failure the exception
            # propagates; callers must not release holds.
            logger.warning(
                "SimpleFI cancel payment_request {} returned {} — re-reading status (single attempt)",
                payment_id,
                response.status_code,
            )
            current = self._non_retrying_get_status(
                f"/payment_requests/{payment_id}", "payment_request"
            )
            return self._classify_cancel_status(
                current.status, payment_id, "payment_request"
            )

        # 5xx: genuine server error — raise
        response.raise_for_status()
        raise RuntimeError("unreachable")  # satisfy type checker

    def cancel_installment_plan(self, plan_id: str) -> CancelOutcome:
        """Cancel a SimpleFi installment_plan without retrying.

        Identical outcome mapping to ``cancel_payment_request`` but targets the
        ``/installment_plans`` endpoint. On 4xx, falls back to a SINGLE
        non-retrying status re-read via ``_non_retrying_get_status`` (not the
        retrying ``_make_request`` path) so the fallback stays bounded to one
        extra attempt. On re-read failure the exception propagates; callers must
        not release holds.

        Note: SimpleFi uses 'cancelled' (two L) in installment_plan status
        responses; the normalizer accepts both spellings.
        """
        response = self._non_retrying_request(
            "PUT", f"/installment_plans/{plan_id}/cancel"
        )

        if response.status_code < 400:
            data = response.json()
            status = data.get("status", "")
            return self._classify_cancel_status(status, plan_id, "installment_plan")

        if response.status_code < 500:
            logger.warning(
                "SimpleFI cancel installment_plan {} returned {} — re-reading status (single attempt)",
                plan_id,
                response.status_code,
            )
            current = self._non_retrying_get_status(
                f"/installment_plans/{plan_id}", "installment_plan"
            )
            return self._classify_cancel_status(
                current.status, plan_id, "installment_plan"
            )

        response.raise_for_status()
        raise RuntimeError("unreachable")

    def get_installment_plan_status(self, plan_id: str) -> SimpleFIPaymentRequestStatus:
        """Fetch the latest status for an existing SimpleFI installment plan."""
        data = self._make_request("GET", f"/installment_plans/{plan_id}")
        payload = data.get("installment_plan", data)
        return SimpleFIPaymentRequestStatus(
            id=payload["id"],
            status=payload["status"],
        )


def get_simplefi_client(api_key: str) -> SimpleFIClient:
    """Get a SimpleFI client instance with the provided API key."""
    return SimpleFIClient(api_key)
