---
name: review-applications
description: Approve, reject, vote on, skip and comment on applications, one by one in the review queue or in bulk.
triggers: approve application,reject application,review application,review queue,vote,strong yes,skip application,bulk approve,approve all,approve many,still in review,why is it in review,status didn't change,accept applicant,comment on application,application comments,aprobar aplicacion,rechazar,revisar
routes: /applications,/applications/review-queue,/applications/$id
roles: operator
---
**Where:**
- [Applications](/applications) → "Review Queue" ([Review Queue](/applications/review-queue)).
- Or any application's detail page.

**Requires:** A selected gathering and operator or above. Applications must be "In Review".

**One by one (recommended):**
1. Go to Applications and click "Review Queue". It shows "Application X of N pending review".
2. In the review sidebar, click "Approve" or "Reject", then confirm.
   - With "Weighted Voting", click "Strong Yes", "Yes", "No" or "Strong No", then "Submit Vote".
3. The queue moves to the next application. "Previous" and "Next" navigate.

**From the list:**
- Row ⋮ menu → "Approve" / "Reject".
- Bulk: check rows, then "Approve (N)" / "Reject (N)". There is no confirmation dialog.

**Skip:** "Skip" removes the application from your queue without voting, with an optional reason. "Undo Skip" brings it back.

**Comments:** The "Comments" box on the detail page holds team notes. Send with "Comment" or ⌘/Ctrl+Enter.

**Gotchas:**
- "Approve" and "Reject" submit your vote. The final status depends on the gathering's review strategy, so an application can stay "In Review" until enough reviewers vote. See the application-review-setup guide.
- With "Weighted Voting" there are no row or bulk actions. Vote from each application.
- The queue is personal: it holds applications pending your review.
- Scholarships and account credit are separate cards on the same page.
