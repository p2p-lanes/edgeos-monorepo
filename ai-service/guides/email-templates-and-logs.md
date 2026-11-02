---
name: email-templates-and-logs
description: Customize and test the emails EdgeOS sends, and check whether an email was sent or failed.
triggers: email,emails,email template,edit email,change email,acceptance email,rejection email,confirmation email,payment confirmed email,login code email,test email,send test,email variables,email log,email logs,did they get the email,email not received,email failed,bounce,resend email,mail,correo,plantilla
routes: /email-templates,/email-templates/$type/edit,/email-logs
roles: operator
---
**Where:**
- Sidebar → "Gathering Management" → "Email Templates" ([Email Templates](/email-templates)).
- Sidebar → "Gathering Management" → "Email Logs" ([Email Logs](/email-logs)).

**Requires:** Operator or above. Most templates and the logs need a selected gathering.

**Edit a template:**
1. Open Email Templates. Pick the sales flow in the selector for flow emails (application, payment, reminders).
2. Find the email by category:
   - Auth: "Portal Login Code".
   - Application: "Application Accepted" and others.
   - Payment: "Payment Confirmed" and others.
   - Event.
   - Check-in: "Check-in Pass".
3. Click "Edit".
4. Change the subject and body. "Variables" inserts placeholders at the cursor.
5. Make sure "Active" is on, then click "Save".
6. Click "Test" → enter an "Email Address" → "Send" to receive a sample.

**Variants:**
- "Default" reloads the default template.
- "Delete" removes the custom version and reverts to the default.

**Scopes:**
- "Portal Login Code" is organization-wide.
- Application, payment and reminder emails are per sales flow.
- Event and check-in emails are per gathering.

**Check delivery:**
1. Open [Email Logs](/email-logs).
2. Search by recipient or subject, and filter by type or status ("Sent" / "Failed").
3. Hover a failed row to see the error.

**Gotchas:**
- Resending an email: this can't be done from the backoffice.
- A badge "Custom - inactive" means the custom version is off and the default is being sent.
- In a test email, gathering variables use real data and other variables show as placeholders.
