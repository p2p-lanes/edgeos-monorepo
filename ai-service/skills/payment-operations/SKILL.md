---
name: payment-operations
description: Investigate and safely operate payments, refunds, credits, installments, and purchased products.
triggers: payment,payments,refund,credit,installment,invoice,pago,pagos,reembolso,credito,factura
operations: payments-list_payments,payments-get_payment,payments-update_payment
---
Payments and their product snapshots are financial history. Current attendee tickets may legitimately differ after administrative grants or swaps.

1. Resolve the exact payment using buyer identity, external reference, amount, date, and gathering. Never select a payment from name alone when multiple records match.
2. Read the payment and product snapshot before any financial action. State currency and amount explicitly.
3. Prefer dedicated domain actions over direct status patches.
4. Financial mutations always require the platform approval control. Never infer refund amount, credit amount, cancellation reason, or destination.
5. Treat timeouts as ambiguous. Read the payment before considering another attempt.
6. Verify final payment status, amount, product/ticket consequences, and request ID after execution.
