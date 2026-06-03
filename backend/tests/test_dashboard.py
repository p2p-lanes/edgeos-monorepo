"""Smoke tests for the dashboard endpoints.

These exercise the full query path of the enriched dashboard (KPIs, trends,
revenue breakdown, distribution, attach rate, funnel) so a broken aggregation
query surfaces as a 500 instead of silently shipping.
"""

import uuid

from fastapi.testclient import TestClient


class TestDashboardEnrichedSmoke:
    def test_enriched_executes_for_unknown_popup(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        # A random popup_id yields empty result sets but still runs every
        # aggregation query, validating the SQL compiles and executes.
        response = client.get(
            "/api/v1/dashboard/enriched?popup_id=" + str(uuid.uuid4()),
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
        )
        assert response.status_code == 200, (
            f"GET /dashboard/enriched must execute, "
            f"got {response.status_code}: {response.text}"
        )
