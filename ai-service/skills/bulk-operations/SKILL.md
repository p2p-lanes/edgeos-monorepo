---
name: bounded-bulk-operations
description: Plan and execute operations that may affect multiple EdgeOS records.
triggers: bulk,all,every,multiple,batch,todos,todas,masivo,lote,varios,varias
operations: applications-grant_tickets_admin
---
Bulk intent must be explicit and bounded.

1. Run a read that produces the exact candidate set and report its count and selection rule.
2. Exclude ambiguous or out-of-scope records. Never broaden a single-record request into a bulk action.
3. Check stock, limits, and other shared constraints before proposing the mutation.
4. The approved operation arguments must encode the same candidate set or a server-owned filter with an explicit maximum impact.
5. After execution, verify counts and list failures separately. Do not automatically retry only the failed subset unless the user starts a new approved request.
