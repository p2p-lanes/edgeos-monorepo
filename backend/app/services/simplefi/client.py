import hashlib
import hmac
import urllib.parse
from decimal import Decimal
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


class SimpleFIPaymentResponse(BaseModel):
    """Response from SimpleFI payment creation."""

    id: str
    status: str
    checkout_url: str


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
            logger.info("SimpleFI API response status: {}, body: {}", response.status_code, response.text)
            response.raise_for_status()
            return response.json()

    def create_payment(
        self,
        amount: Decimal,
        popup_slug: str,
        tenant_slug: str,
        reference: dict[str, Any] | None = None,
        memo: str = "EdgeOS Payment",
    ) -> SimpleFIPaymentResponse:
        """
        Create a payment request in SimpleFI.

        Args:
            amount: The payment amount in USD
            popup_slug: The popup slug for building portal redirect URLs
            tenant_slug: The tenant slug for the portal subdomain
            reference: Optional reference data (application_id, email, products)

        Returns:
            SimpleFIPaymentResponse with id, status, and checkout_url
        """
        notification_url = urllib.parse.urljoin(
            settings.BACKEND_URL, "/api/v1/payments/webhook/simplefi"
        )

        portal_base = self._build_tenant_portal_url(tenant_slug)
        success_url = f"{portal_base}/portal/{popup_slug}/passes/buy?checkout=success"
        cancel_url = f"{portal_base}/portal/{popup_slug}/passes/buy"

        body = {
            "amount": float(amount),
            "currency": "USD",
            "reference": reference or {},
            "memo": memo,
            "notification_url": notification_url,
            "redirect_urls": {
                "success_url": success_url,
                "cancel_url": cancel_url,
            },
        }

        logger.info("Creating SimpleFI payment for amount: {}", amount)
        data = self._make_request("POST", "/payment_requests", json=body)

        return SimpleFIPaymentResponse(
            id=data["id"],
            status=data["status"],
            checkout_url=data["checkout_v2_url"],
        )


def get_simplefi_client(api_key: str) -> SimpleFIClient:
    """Get a SimpleFI client instance with the provided API key."""
    return SimpleFIClient(api_key)


def verify_webhook_signature(
    payload: bytes, signature: str | None, secret: str | None
) -> bool:
    """
    Verify SimpleFI webhook signature using HMAC-SHA256.

    Args:
        payload: Raw request body bytes
        signature: Signature from X-SimpleFI-Signature header
        secret: The popup's simplefi_api_key used as webhook secret

    Returns:
        True if signature is valid or secret is not configured (skip validation).
        False if signature is invalid.
    """
    # Skip validation if no secret is configured
    if not secret:
        logger.warning("No SimpleFI API key configured, skipping signature validation")
        return True

    # Reject if signature is missing but secret is configured
    if not signature:
        logger.warning("Missing webhook signature header")
        return False

    # Compute expected signature
    expected = hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()

    # Compare signatures using constant-time comparison
    is_valid = hmac.compare_digest(expected, signature)

    if not is_valid:
        logger.warning("Invalid webhook signature")

    return is_valid
