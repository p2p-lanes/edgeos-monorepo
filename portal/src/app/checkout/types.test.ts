import type { ApplicationFormSchema } from "@/types/form-schema"
import { getCheckoutMiniFormSchema, getCheckoutSchemaSections } from "./types"

function createSchema(
  overrides: Partial<ApplicationFormSchema> = {},
): ApplicationFormSchema {
  return {
    base_fields: {
      email: {
        type: "email",
        label: "Email",
        required: true,
        target: "human",
      },
      first_name: {
        type: "text",
        label: "First name",
        required: true,
        section_id: "personal",
        position: 2,
        target: "human",
      },
      telegram: {
        type: "text",
        label: "Telegram",
        required: true,
        section_id: "personal",
        position: 3,
        target: "human",
      },
    },
    custom_fields: {
      tshirt_size: {
        type: "select",
        label: "T-Shirt size",
        required: true,
        section_id: "preferences",
        position: 1,
        options: ["S", "M"],
      },
    },
    sections: [
      {
        id: "personal",
        label: "Personal info",
        description: "About you",
        order: 1,
        kind: "standard",
      },
      {
        id: "preferences",
        label: "Preferences",
        description: "Your choices",
        order: 2,
        kind: "standard",
      },
    ],
    ...overrides,
  }
}

describe("checkout application schema helpers", () => {
  it("keeps custom fields that belong to checkout-visible sections", () => {
    const miniFormSchema = getCheckoutMiniFormSchema(
      createSchema({
        base_fields: {
          email: {
            type: "email",
            label: "Email",
            required: true,
            target: "human",
          },
          referral: {
            type: "text",
            label: "Referral",
            required: true,
            target: "application",
          },
        },
        custom_fields: {
          favorite_color: {
            type: "text",
            label: "Favorite color",
            required: true,
            section_id: "preferences",
          },
          document_id: {
            type: "text",
            label: "Document",
            required: true,
            section_id: "_unsectioned_base",
          },
        },
      }),
    )

    expect(Object.keys(miniFormSchema.base_fields)).toEqual(["email"])
    expect(Object.keys(miniFormSchema.custom_fields)).toEqual(["document_id"])
  })

  it("keeps checkout on the mini-form subset when schema has special sections or unsupported application-only fields", () => {
    const schemaWithOutOfScopeFields = createSchema({
      base_fields: {
        email: {
          type: "email",
          label: "Email",
          required: true,
          target: "human",
        },
        markdown_notes: {
          type: "textarea",
          label: "Notes",
          required: false,
          target: "application",
        },
      },
      custom_fields: {},
      sections: [
        {
          id: "companions",
          label: "Companions",
          description: null,
          order: 1,
          kind: "companions",
        },
      ],
    })

    expect(
      Object.keys(
        getCheckoutMiniFormSchema(schemaWithOutOfScopeFields).base_fields,
      ),
    ).toEqual(["email"])
  })

  it("orders base and custom fields by schema sections", () => {
    const sections = getCheckoutSchemaSections(
      createSchema({
        custom_fields: {
          document_id: {
            type: "text",
            label: "Document",
            required: false,
            section_id: "personal",
            position: 1,
          },
        },
      }),
    )

    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({
      id: "_unsectioned_base",
      fields: [{ name: "email", isCustom: false }],
    })
    expect(sections[1]).toMatchObject({
      id: "personal",
      fields: [
        { name: "custom_document_id", isCustom: true },
        { name: "first_name", isCustom: false },
        { name: "telegram", isCustom: false },
      ],
    })
  })

  // The mini-form reduction only makes sense for the APPLICATION checkout,
  // where the full form is large and the checkout shows a cut-down view keyed
  // off the sections that hold human-target base fields. In open ticketing the
  // popup's buyer form IS the whole form: there is nothing to reduce, and a
  // popup with no BaseFieldConfigs has no base fields to key off, so the
  // reduction silently deleted every field the organizer had configured.
  describe("includeAllSections (open ticketing)", () => {
    // Pins the application-flow default so the opt-in can't quietly become
    // the norm: `tshirt_size` sits in `preferences`, a section with no base
    // field, so the reduction drops it.
    it("drops custom fields outside base-field sections by default", () => {
      const sections = getCheckoutSchemaSections(createSchema())
      const names = sections.flatMap((s) => s.fields.map((f) => f.name))
      expect(names).not.toContain("custom_tshirt_size")
    })

    it("keeps them when the caller opts out of the reduction", () => {
      const sections = getCheckoutSchemaSections(createSchema(), {
        includeAllSections: true,
      })
      const names = sections.flatMap((s) => s.fields.map((f) => f.name))
      expect(names).toContain("custom_tshirt_size")
    })

    // The exact shape that broke the live Amanita popup: zero
    // BaseFieldConfigs, so `base_fields` arrives empty and every organizer
    // field hangs off a section the reduction considered invisible. All three
    // were `required`, so the backend rejected the purchase with a 422 for
    // fields the shopper was never shown.
    it("renders an organizer's fields when the popup has no base fields at all", () => {
      const sections = getCheckoutSchemaSections(
        createSchema({
          base_fields: {},
          custom_fields: {
            new_phone_field: {
              type: "phone",
              label: "phone",
              required: true,
              section_id: "personal",
              position: 0,
            },
          },
        }),
        { includeAllSections: true },
      )
      const names = sections.flatMap((s) => s.fields.map((f) => f.name))
      expect(names).toEqual(["custom_new_phone_field"])
    })
  })
})
