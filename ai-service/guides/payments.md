---
name: payments
description: Find payments, see what was bought and charged, download invoices and export payments. Lists what cannot be done with payments.
triggers: payments,payment,transactions,sales,revenue,who paid,pending payment,payment status,refund,reembolso,devolucion,approve payment,mark as paid,edit payment,invoice,receipt,factura,download invoice,installments,export payments,payments csv,charged,pagos
routes: /payments
roles: viewer
---
**Where:** Sidebar → "Registrations" → "Payments" ([Payments](/payments)). The badge on the item counts pending payments.

**Requires:** A selected gathering.

**Find:**
1. Use "Search by ID, email, or name...".
2. Click "Filter":
   - Status: Pending, Approved, Rejected, Expired, Cancelled.
   - Source: SimpleFI, Stripe, MercadoPago, Crypto.
   - Type: Pass purchase or Application fee.
   - Amount, Date, Sales flow, Product.
3. Expand a row ("N products") to see the line items, discounts, insurance, contribution, total, charged amount and installments.
4. In the expanded row, "Response history" shows edits to the buyer's form answers.

From an application, "View payments" opens this page filtered to that application.

**Invoice:** Click "Download invoice PDF" on the row.
- It only appears for approved payments above 0.
- The gathering needs "Invoice Settings" (company name, address, email) in [Gatherings](/popups) → edit → "Commerce".

**Export:** "Export CSV", or "Export filtered CSV".

**Not possible here:** Refunding, approving or rejecting, or editing a payment: this can't be done from the backoffice.

**Gotchas:**
- "Charged" can differ from "Amount" because of card or crypto adjustments or installments ("so far").
- Granted tickets have no payment.
