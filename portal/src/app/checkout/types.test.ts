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
})
