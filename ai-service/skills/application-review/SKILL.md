---
name: application-review-operations
description: Investigate, review, accept, reject, or otherwise operate applications safely.
triggers: application,applications,applicant,review,accept,reject,solicitud,solicitudes,revisar,aceptar,rechazar
operations: applications-list_applications,applications-get_application,application-reviews-list_reviews,application-reviews-submit_review,applications-update_application
---
An application belongs to one human and one gathering; its attendees and payments are related but distinct records.

1. Resolve the application in the selected gathering and inspect its current status, human, attendees, reviews, and relevant payment state.
2. Never infer a review decision from ratings, comments, or previous applications.
3. Before a mutation, identify the exact transition and any supplied reason. Do not invent review text or optional fields.
4. Search for the operation representing the intended domain transition instead of patching status fields blindly when a dedicated action exists.
5. After executing, read the application and verify its status and decision. If a transition triggers fees, credits, emails, or attendee changes, report those side effects from live results.
