"""Validate the local spouse seed through HTTP and authenticate QA browsers.

Run with .venv/bin/python scripts/validate-spouse-ticket-qa.py. Uses only local
API/Mailpit endpoints. Tokens and OTPs stay in memory and are never printed.
"""

import json
import re
import subprocess
import time

import httpx

API = "http://localhost:8000"
MAILPIT = "http://localhost:8025"


def request(client, method, path, **kwargs):
    response = client.request(method, f"{API}{path}", **kwargs)
    response.raise_for_status()
    return response.json() if response.content else None


def login(client, email, tenant_id=None):
    surface = "human" if tenant_id else "user"
    payload = {"email": email}
    if tenant_id:
        payload["tenant_id"] = tenant_id
    request(client, "POST", f"/api/v1/auth/{surface}/login", json=payload)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        messages = client.get(
            f"{MAILPIT}/api/v1/search", params={"query": f"to:{email}", "limit": 5}
        ).json()["messages"]
        if messages:
            latest = max(messages, key=lambda item: item["Created"])
            detail = client.get(f"{MAILPIT}/api/v1/message/{latest['ID']}").json()
            match = re.search(r"\b(\d{6})\b", detail["Text"] or detail["HTML"])
            if match:
                payload["code"] = match[1]
                return request(
                    client,
                    "POST",
                    f"/api/v1/auth/{surface}/authenticate",
                    json=payload,
                )["access_token"]
        time.sleep(0.25)
    raise RuntimeError("Local Mailpit did not receive an authentication message")


def browser(session, command, *args, script=None):
    result = subprocess.run(
        ["agent-browser", "--session", session, command, *args],
        input=script,
        text=True,
        capture_output=True,
        check=True,
    )
    # Never echo eval source; it can contain a token in memory.
    return result.stdout


def main():
    with httpx.Client(timeout=20) as client:
        tenant = request(client, "GET", "/api/v1/tenants/public/demo")
        tid = tenant["id"]
        admin_token = login(client, "admin@example.com")
        admin_headers = {
            "Authorization": f"Bearer {admin_token}",
            "X-Tenant-Id": tid,
        }
        popup = next(
            row
            for row in request(
                client,
                "GET",
                "/api/v1/popups",
                headers=admin_headers,
                params={"search": "Spouse Ticket QA"},
            )["results"]
            if row["slug"] == "spouse-ticket-qa"
        )
        pid = popup["id"]
        results = []
        for name in ("jon", "lucy", "linked"):
            email = f"{name}.spouse.qa@example.com"
            token = login(client, email, tid)
            headers = {"Authorization": f"Bearer {token}"}
            tickets = request(
                client, "GET", "/api/v1/applications/my/tickets", headers=headers
            )
            own = [row for row in tickets if row["popup_id"] == pid]
            products = [product for row in own for product in row["products"]]
            assert len(products) == 1, (name, products)
            assert products[0]["quantity"] == 1, (name, products)
            assert products[0]["category"] == "ticket", (name, products)
            expected = "Standard" if name == "lucy" else "Spouse"
            assert expected in products[0]["name"], (name, products)
            units = [unit for row in own for unit in row.get("tickets", [])]
            assert len(units) == 1, (name, len(units))
            assert units[0]["check_in_code"]
            assert units[0]["requires_check_in"] is True
            results.append(
                {
                    "account": email,
                    "tickets": products,
                    "detailed_ticket_units": len(units),
                    "status": 200,
                }
            )

            spoofed = request(
                client,
                "GET",
                "/api/v1/applications/my/tickets",
                headers=headers,
                params={"email": "lucy.spouse.qa@example.com"},
            )
            assert spoofed == tickets
            attendees = request(
                client, "GET", f"/api/v1/attendees/my/popup/{pid}", headers=headers
            )["results"]
            purchases = request(
                client,
                "GET",
                f"/api/v1/applications/my/{pid}/purchases",
                headers=headers,
            )
            if name == "jon":
                assert all(not row["products"] for row in attendees)
                assert all(not row["products"] for row in purchases)
                results.append(
                    {
                        "read_only_separation": "Management reads remain unchanged; personal tickets are rendered separately",
                        "portal_attendees": len(attendees),
                        "portal_ticket_units": sum(
                            len(row["products"]) for row in attendees
                        ),
                        "purchases": purchases,
                    }
                )
            browser_session = f"spouse-qa-{name}"
            browser(browser_session, "open", "http://demo.localhost:3000")
            browser(
                browser_session,
                "eval",
                "--stdin",
                script=f"localStorage.setItem('token', {json.dumps(token)}); true",
            )
            browser(
                browser_session,
                "open",
                f"http://demo.localhost:3000/portal/{popup['slug']}/passes",
            )
            browser(browser_session, "wait", "--text", products[0]["name"])
            ui = json.loads(
                browser(
                    browser_session,
                    "eval",
                    "--stdin",
                    script=(
                        "(() => { const text = document.body.innerText; return {"
                        f"productVisible: text.includes({json.dumps(products[0]['name'])}),"
                        "noPassMessage: text.includes('You do not yet have any passes'),"
                        "hasQrButton: !!document.querySelector('button[aria-label=\"Check-in code\"]')"
                        "}; })()"
                    ),
                )
            )
            assert ui["productVisible"] is True
            assert ui["hasQrButton"] is True
            if name == "jon":
                assert ui["noPassMessage"] is False
            results.append({"portal_account": email, "ui": ui})

        # Read-only fallback: after actual login + HTTP reads, the paid attendee
        # must still be unclaimed and its application provenance unchanged.
        jon_rows = request(
            client,
            "GET",
            "/api/v1/attendees",
            headers=admin_headers,
            params={"email": "jon.spouse.qa@example.com"},
        )["results"]
        unlinked = next(row for row in jon_rows if row["category"] == "spouse")
        assert unlinked["human_id"] is None
        assert unlinked["application_id"] is None
        results.append({"read_did_not_claim_spouse": True})
        bo_tickets = request(
            client,
            "GET",
            "/api/v1/attendees/tickets/jon.spouse.qa@example.com",
            headers=admin_headers,
        )
        assert any(row["id"] == unlinked["id"] for row in bo_tickets)
        assert all("tickets" not in row for row in bo_tickets)
        assert "check_in_code" not in json.dumps(bo_tickets)
        results.append({"backoffice_ticket_lookup": "unchanged, spouse present"})
        anonymous = client.get(f"{API}/api/v1/applications/my/tickets")
        assert anonymous.status_code == 401
        admin_as_human = client.get(
            f"{API}/api/v1/applications/my/tickets", headers=admin_headers
        )
        assert admin_as_human.status_code in (401, 403)
        results.append(
            {
                "anonymous_status": 401,
                "backoffice_token_status": admin_as_human.status_code,
            }
        )

        browser("spouse-qa-admin", "open", "http://localhost:5173")
        browser(
            "spouse-qa-admin",
            "eval",
            "--stdin",
            script=(
                f"localStorage.setItem('access_token', {json.dumps(admin_token)});"
                f"localStorage.setItem('workspace_tenant_id', {json.dumps(tid)});"
                f"localStorage.setItem('workspace_popup_id', {json.dumps(pid)});"
                "localStorage.setItem('onboarding_tour_seen', 'true'); true"
            ),
        )
        browser("spouse-qa-admin", "open", "http://localhost:5173/attendees")
        print(json.dumps({"popup_id": pid, "checks": results}, indent=2))  # noqa: T201


if __name__ == "__main__":
    main()
