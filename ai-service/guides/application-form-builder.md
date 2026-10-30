---
name: application-form-builder
description: Edit the application or buyer form of a sales flow, add questions and sections, copy a form from another flow.
triggers: form builder,application form,add question,new question,edit question,form field,custom field,required field,form section,buyer form,questions,predefined fields,copy form,multi-step form,single page form,remove question,delete field,formulario,agregar pregunta
routes: /form-builder
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Form Builder" ([Form Builder](/form-builder)).

**Requires:** A selected gathering and operator or above. The page says "You need admin permissions…", but operators can use it.

**Steps:**
1. Pick the sales flow in the selector at the top ("Choose a sales flow"). Each flow has its own form.
2. Add a section with "Add Section". Sections can be renamed, described, hidden from the portal and reordered by dragging.
3. Drag a field type from the "Field Types" palette into a section, e.g. Text, Email, Select, Pills, Country, Image upload, Signature.
4. Click a field to open "Field Settings": "Display Label", "Placeholder", "Help Text", "Required", "Options" (one per line). Changes save on their own ("Field saved").
5. Use "Add predefined fields" for common fields such as "Personal Information", "Children and +1s" or "Scholarship".
6. Use the layout dropdown to switch between "Single page" and "Multi-step".

**Variants:** "Copy form from..." replaces this flow's form with an independent copy of another flow's form.

**Gotchas:**
- Everything saves automatically. There is no Save button.
- Deleting a field ("Delete Form Field") can lose stored answers and cannot be undone.
- Fields marked "Protected" come from the base catalog. Removing them only takes them off this gathering.
- If the flow cannot sell, the page warns that nothing reaches a buyer.
