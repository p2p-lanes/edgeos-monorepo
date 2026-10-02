# Human assessment privacy

`rating`, its derived `red_flag`, and `enriched_profile` are administrative
assessment data, not user-owned profile fields.

## API boundaries

- `HumanSelfPublic` is the allowlisted own-profile response for the portal and
  third-party human sessions. `HumanPublic` remains the administrative response.
- `AuthenticatedHuman` is an internal dependency result. It retains assessment
  fields for rejection, API-key, group, invite and restriction gates. Never use
  it as a response model.
- All applicant-facing application routes use `ApplicationPortalPublic`, with
  `HumanSelfPublic` and `AttendeePortalPublic` nested responses. Administrative
  applications retain `ApplicationPublic`, including review information.
- Portal payment recipients, attendees and cart recipients project stored
  profile metadata through `public_profile_metadata`. This strips reserved
  assessment keys from the **root of a profile snapshot**, not arbitrary nested
  answers to custom forms. Historical database records are not modified by the
  projection. Scanner attendee responses apply the same projection.
- Public checkout, cart and attendee inputs discard these reserved root keys,
  including requests from old clients. The portal also strips them from drafts
  restored from browser caches before checkout/cart persistence.
- Public registration cannot set an assessment. New humans are always `unrated`,
  even if a historical pending registration held a flag. Existing humans keep
  their administrative rating.
- Group errors do not disclose a person's rating. API-key errors do not expose
  internal blocking reasons.

## Administrative permissions

Human assessments retain the existing administrative endpoint policy:
`superadmin`, `admin`, and `operator` JWTs, or administrative API keys with the
required `humans:read` / `humans:write` scopes and tenant context.
Enrichment provenance uses the same scoped policy. Viewers, scanner accounts,
humans and third-party human sessions cannot read or write enrichment facts.
The abandoned-cart listing also requires an administrative role.

## Deployment and historical copies

Deploy backend and regenerated frontend clients together. The backend is the
privacy boundary and must not depend on clients dropping fields.

This change does **not** delete or overwrite historical profile snapshots or
`humans.enriched_profile`, and requires no database migration. Any later cleanup
of persisted copies is a separate operation requiring a preview and approval.
Previously disclosed responses cannot be recalled. The updated portal prevents
old cached checkout drafts from re-submitting the assessment keys.

Regression coverage lives in:
- `backend/tests/api/human/test_profile_privacy.py`
- `backend/tests/api/human/test_profile_privacy_api.py`
- `portal/src/lib/public-profile-metadata.test.ts`
