---
name: products
description: Create and edit products (tickets, housing, merch), set price, stock and sale window, and mark products sold out.
triggers: create product,new product,create ticket,new ticket type,ticket type,pass type,price,change price,stock,inventory,sold out,mark sold out,sale window,sale starts,sale ends,compare at price,max per order,merch,merchandise,housing product,patron,discountable,exclusive,deactivate product,product not showing,crear producto,precio,agotado
routes: /products,/products/new,/products/$id/edit
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Products" ([Products](/products)).

**Requires:** A selected gathering and operator or above.

**Create:**
1. Click "Add Product".
2. Fill in the name and pick a category: "Ticket", "Housing", "Merchandise", "Other" or "Patreon". "Add category" creates a custom category.
3. Under "Pricing & Inventory", set:
   - "Price".
   - "Compare-at price" (optional, shown crossed out).
   - "Total stock" (empty means unlimited).
   - "Max per order".
4. Set the switches:
   - "Active": available for purchase.
   - "Discountable": coupons, group and scholarship discounts apply.
   - "Exclusive".
   - "Insurance Eligible".
   - "Requires Check-in".
5. For tickets, set "Duration".
6. Optionally set a "Sale Window" ("Sale Starts At" / "Sale Ends At", in the gathering's time zone).
7. Click "Create Product".

**Edit:** Click the product, change the fields and click "Save Changes".

**Mark sold out:** In the list, open the row's ⋮ menu → "Mark as sold out" (or "Unmark sold out"). This is a manual override regardless of stock.

**Delete:** Edit page → "Delete Product". Existing purchases are not affected.

**Gotchas:**
- Creating a product does not put it on sale. It appears in a checkout only through a step in [Ticketing Steps](/ticketing-steps), via the step's "Product Category" or its assigned products. If a product doesn't show in the checkout, check Ticketing Steps, "Active", the sale window and stock.
- Inactive products cannot be granted to attendees either.
- Only one Patreon product is allowed per gathering.
- Accommodation rooms are not products. They are managed in [Accommodations](/accommodations).
