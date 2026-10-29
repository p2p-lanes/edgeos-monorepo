---
name: application-review-setup
description: Configure how applications are approved (review strategy) and who reviews them.
triggers: review strategy,approval strategy,who approves,who reviews,add reviewer,reviewers,required reviewer,auto accept,auto approve applications,weighted voting,threshold,any reviewer,all reviewers,disable review,quien aprueba,revisores
routes: /popups/$id/edit,/sales-flows/$id/edit
roles: operator
---
**Where:** [Gatherings](/popups) → click the gathering → "General" tab → "Application Review" and "Reviewers".

**Requires:** Operator or above. The gathering must already exist; these sections only show in edit mode.

**Choose the strategy:**
1. Under "Application Review", pick a "Review Strategy":
   - "Auto Accept": no review.
   - "Any Reviewer": one approval is enough.
   - "All Reviewers": every required reviewer must approve.
   - "Threshold": set "Required Approvals", or "Accept"/"Reject" thresholds.
   - "Weighted Voting": set "Vote Weights" for "Strong Yes", "Yes", "No" and "Strong No".
2. It saves when you leave the field ("Approval strategy saved").
3. "Disable Review" turns review off.

**Add reviewers:**
1. Under "Reviewers", click "Add Reviewer".
2. Pick the "User". Check "Required Reviewer" if their approval is mandatory for "All Reviewers".
3. Remove a reviewer with "Remove Reviewer".

**Variants:** A sales flow of type Application can have its own reviewer list: [Sales Flows](/sales-flows) → edit the flow → "Reviewers". Adding a reviewer there switches that flow to its own list.

**Gotchas:**
- With no reviewers assigned, any admin user can review.
- Reviewers only appear when the gathering takes applications and the strategy is not "Auto Accept".
- With "Weighted Voting", the Applications list has no bulk Approve/Reject. Reviewers vote from each application.
