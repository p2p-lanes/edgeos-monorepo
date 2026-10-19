# Post-purchase form responses

A Buyer Form step can opt into **Allow editing after purchase** in Ticketing Steps.
An enabled editing policy requires an editing deadline. The backoffice interprets
the wall-clock deadline in the popup’s configured time zone (UTC if unset); the API
stores an absolute timestamp. The portal also uses the popup’s current time zone. New and existing steps default to
editing disabled. Checkout visibility and post-purchase editing are independent.

The buyer opens a purchased ticket in Purchases, or its payment in Payments,
and selects **Edit responses**. Answers are read-only when editing is disabled,
the deadline has passed, or the payment is not approved. Recipients cannot edit
the purchaser's responses. Changes apply to the whole payment, not one ticket
unit; multiple tickets bought in the same transaction share those answers.

## API

- `GET /api/v1/payments/my/{payment_id}/form-responses`: buyer-only responses,
  live edit policy, version and history.
- `PATCH /api/v1/payments/my/{payment_id}/form-responses`: requires a portal
  Human session with `portal:payments:write` (regular first-party portal sessions
  have `portal:*`). This new write scope is not granted to third-party apps.
- `GET /api/v1/payments/{payment_id}/form-responses`: tenant-scoped operator or
  `payments:read` API-key access to responses and history.

Example PATCH body:

```json
{
  "version": 0,
  "answers": {
    "c9109399-4798-49f2-b30e-7ab6fa356821": "Circle Coworking"
  }
}
```

Custom fields still belonging to the payment’s original flow may be edited,
including questions absent from historical snapshots. When editing is enabled,
GET represents missing, visible standard-form questions as unanswered without
changing stored data. Display-only content is not offered for completion. Required values, types, available options and date
bounds are validated against current field definitions. Deleted, hidden or
retyped fields remain readable but cannot be changed. Identity, product details,
amounts, payment status, labels and sections cannot be updated through this API.
Additional body properties are rejected. A stale version returns 409; policy or
deadline violations return 403; unavailable payments return 404.

## Storage and audit

`payments.buyer_snapshot` retains existing purchase-time labels and structure.
Existing questions update only `sections[].fields[].value`; a question absent at
purchase is appended on its first answer with its current label, type and section.
Only answered fields are added, and all newly missing required questions must be
completed when saving. The audit records null → answer for each new response. `payments.form_response_version` advances
once per successful, nonempty change set. No-op saves create no history.

`payment_form_response_changes` stores the payment, field ID and original label,
old/new JSON values, buyer Human ID, timestamp and version. It is tenant-isolated
with RLS and tenant roles cannot update or delete history rows. Payment locking,
policy checks, answer updates and audit inserts share one transaction. History is
available in the backoffice and via the API; the portal shows current answers only. Recipient and profile snapshots
remain purchase-time records and are not rewritten.

Migration `f6b2a9d1c804` adds the settings, version and history table without
rewriting existing payments. Existing snapshot answers can be edited once a
policy is enabled. Buyers can supply missing answers under that same live policy;
prior answers that were never saved cannot be reconstructed. New
checkout snapshots include unsectioned fields and only the selected flow.
