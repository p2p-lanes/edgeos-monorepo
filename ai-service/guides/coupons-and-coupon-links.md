---
name: coupons-and-coupon-links
description: Create discount coupons and share a checkout link with the coupon already applied.
triggers: coupon,coupons,discount code,promo code,promotion,discount,create coupon,coupon link,link with coupon,apply coupon automatically,coupon not working,max uses,expire coupon,deactivate coupon,cupon,codigo de descuento,descuento
routes: /coupons,/coupons/new,/coupons/$id/edit,/sales-flows/$id/edit
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Coupons" ([Coupons](/coupons)).

**Requires:** A selected gathering and operator or above. The sales flow must have "Allows Coupons" on: [Sales Flows](/sales-flows) → edit the flow → "Discounts".

**Create:**
1. Click "Add Coupon".
2. Enter the code. It is uppercased.
3. Pick the "Sales flow". The coupon only works in that flow, and the flow cannot be changed later.
4. Set "Discount %" (1–100), "Max Uses" (empty means unlimited) and "Active".
5. Optionally set "Start Date" and "End Date".
6. Click "Create Coupon".

**Share a link with the coupon applied:** There is no button for this; build the link by hand.
1. [Sales Flows](/sales-flows) → open the direct flow and copy its "Flow URL".
2. Append `?coupon=CODE`, or `&coupon=CODE` if the URL already has a `?`.

**Gotchas:**
- Coupon links only work on direct ("People buy directly") flow checkouts, not application flow links.
- An invalid, inactive, expired or used-up code is silently ignored and the buyer sees the normal price.
- Products with "Discountable" off never get discounted.
- Coupons are open codes. For one specific person use [Invites](/invites); for teams use [Groups](/groups).
- Deleting a coupon ("Delete Coupon") does not change discounts already applied.
