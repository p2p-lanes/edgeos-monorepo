import type { ApplicationPublic } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { buildCheckoutApplicationMutationPayload } from "./useCheckoutState"

const schema: ApplicationFormSchema = {
  base_fields: {
    first_name: {
      type: "text",
      label: "First name",
      required: true,
      target: "human",
    },
    scholarship_request: {
      type: "boolean",
      label: "Scholarship",
      required: false,
      target: "application",
    },
  },
  custom_fields: {
    favorite_color: {
      type: "text",
      label: "Favorite color",
      required: false,
    },
  },
  sections: [],
}

describe("buildCheckoutApplicationMutationPayload", () => {
  it("builds create payloads from checkout-visible base and custom fields", () => {
    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: true,
          custom_favorite_color: "Blue",
          gender_specify: "ignored",
        },
        existingApplication: null,
      }),
    ).toEqual({
      kind: "create",
      payload: {
        popup_id: "popup-1",
        first_name: "Matias",
        last_name: "",
        custom_fields: {
          favorite_color: "Blue",
        },
        status: "in review",
      },
    })
  })

  it("builds update payloads from checkout-visible base and custom fields", () => {
    const existingApplication = {
      id: "app-1",
      popup_id: "popup-1",
    } as ApplicationPublic

    expect(
      buildCheckoutApplicationMutationPayload({
        popupId: "popup-1",
        schema,
        values: {
          first_name: "Matias",
          scholarship_request: false,
          custom_favorite_color: "Green",
        },
        existingApplication,
      }),
    ).toEqual({
      kind: "update",
      payload: {
        first_name: "Matias",
        custom_fields: {
          favorite_color: "Green",
        },
        status: "in review",
      },
    })
  })
})
