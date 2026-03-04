# Form Builder - Architecture & Context

## Overview

The Form Builder is a visual drag-and-drop tool in the backoffice that allows admins to create application forms. These forms are rendered in the portal using `DynamicApplicationForm`. The builder produces `FormFieldPublic` records via the API, which the portal fetches as an `ApplicationFormSchema` and renders dynamically.

## File Structure

```
backoffice/src/
├── routes/_layout/form-builder/
│   ├── index.tsx          # Main page: DnD context, layout (canvas + palette sidebar), Sheet for config, mutations
│   ├── new.tsx            # Legacy create page (still functional as fallback)
│   └── $id.edit.tsx       # Legacy edit page (still functional as fallback)
├── components/form-builder/
│   ├── constants.ts       # FIELD_TYPES (9 types with icons), FULL_WIDTH_TYPES, slugify(), DnD prefixes
│   ├── FieldPalette.tsx   # Right sidebar: draggable field types using useDraggable
│   ├── FormCanvas.tsx     # Center panel: renders sections, groups fields by section, "Add Section" button
│   ├── SectionDropZone.tsx# Portal-style section: grid [220px,1fr], title left, fields right, droppable + sortable
│   ├── CanvasField.tsx    # Individual field card: portal-style preview (label + help_text + input), hover controls
│   ├── FieldConfigPanel.tsx # Sheet content: edit field properties, explicit Save button, auto-generated name
│   ├── DragOverlayContent.tsx # Visual overlay during drag (palette item vs canvas field)
│   └── index.ts           # Barrel exports
├── components/forms/
│   └── FormFieldForm.tsx  # Legacy form for create/edit (used by new.tsx and $id.edit.tsx)
```

## Page Layout

```
┌──────────────────────────────────────────────────────────┬─────────────┐
│                     Form Canvas                          │  Field      │
│  ┌──────────┬───────────────────────────────────┐       │  Palette    │
│  │ Section  │  ┌─────────┐  ┌─────────┐        │       │  (280px)    │
│  │ Title    │  │ Field 1 │  │ Field 2 │        │       │             │
│  │          │  └─────────┘  └─────────┘        │       │  - Text     │
│  └──────────┴───────────────────────────────────┘       │  - Textarea │
│  ─────────────────── separator ──────────────────        │  - Number   │
│  ┌──────────┬───────────────────────────────────┐       │  - Boolean  │
│  │ Section  │  ┌─────────┐                      │       │  - Select   │
│  │ Title    │  │ Field 3 │                      │       │  - Multi    │
│  └──────────┴───────────────────────────────────┘       │  - Date     │
│                                                          │  - Email    │
│  [ + Add Section ]                                       │  - URL      │
└──────────────────────────────────────────────────────────┴─────────────┘

Click a field → Sheet slides from right with config panel → Save button
```

## Drag-and-Drop Flow

1. **Palette → Canvas**: User drags a field type from the right sidebar. On drop onto a section, `createMutation` fires `FormFieldsService.createFormField()` with auto-generated name and default label. The new field is auto-selected, opening the config Sheet.

2. **Canvas reorder**: Fields within a section can be dragged to reorder. On drop, `persistReorder()` sends `updateFormField()` calls to update positions.

3. **Cross-section move**: Dragging a field to a different section updates both the source and target section positions.

Collision detection is hybrid: `pointerWithin` for palette drops, `closestCenter` for canvas reordering.

## Field Types

| Type        | Portal Component    | Full Width |
|-------------|---------------------|------------|
| text        | InputForm           | No         |
| textarea    | TextAreaForm        | Yes        |
| number      | InputForm (number)  | No         |
| boolean     | CheckboxForm        | No         |
| select      | SelectForm          | No         |
| multiselect | MultiSelect         | Yes        |
| date        | InputForm (date)    | No         |
| email       | InputForm (email)   | No         |
| url         | InputForm (url)     | No         |

## Field Name Auto-Generation

The `name` field is auto-generated using `slugify(section, label, field_type)`.

Example: section="Personal Information", label="First name", type="text"
→ `personal_information_first_name_text`

The `slugify()` function: lowercases, replaces non-alphanumeric chars with `_`, trims leading/trailing underscores, collapses multiple underscores.

## API Endpoints (no backend changes)

| Endpoint                             | Method | Usage                          |
|--------------------------------------|--------|--------------------------------|
| `/api/v1/form-fields`               | GET    | List fields (with popup_id)    |
| `/api/v1/form-fields`               | POST   | Create field (on palette drop) |
| `/api/v1/form-fields/{field_id}`    | PATCH  | Update field (config save, reorder, section rename) |
| `/api/v1/form-fields/{field_id}`    | DELETE | Delete field                   |
| `/api/v1/form-fields/schema/{popup_id}` | GET | Get application schema (portal) |

## Key Types

```typescript
// From backoffice/src/client/types.gen.ts
type FormFieldPublic = {
  id: string; tenant_id: string; popup_id: string;
  name: string; label: string; field_type: string;
  section?: string | null; position?: number;
  required?: boolean; options?: string[] | null;
  placeholder?: string | null; help_text?: string | null;
}

// From portal/src/types/form-schema.ts
interface ApplicationFormSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: string[]
}
```

## Portal Rendering Reference

The portal renders forms in `portal/src/app/portal/[popupSlug]/application/components/`:
- `dynamic-application-form.tsx` - Main form, groups fields by section
- `fields/dynamic-field.tsx` - Switch on `field.type` to render correct input component
- `form-section.tsx` - Section with title + 2-col grid
- `SectionWrapper.tsx` - Layout: `grid gap-10 lg:grid-cols-[220px,1fr]`, title left, fields right

## Pending / Future Work

- **Conditional fields**: Show/hide fields based on other field values (e.g., "if gender = Specify, show specify input"). Currently hardcoded in portal for gender only. Needs schema extension.
- **Section subtitles**: Sections currently only have a name. Could add a subtitle/description field.
- **Section ordering**: Sections are ordered by appearance in fields. Could add explicit section ordering.
- **Field duplication**: Quick-duplicate a field within a section.
- **Preview mode**: Toggle to see the form exactly as portal renders it (read-only preview).
- **Undo/redo**: Track changes and allow undo.
- **Bulk operations**: Select multiple fields to move/delete.
