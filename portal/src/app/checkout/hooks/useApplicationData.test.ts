import type { ApplicationPublic, HumanPublic } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { hydrateCheckoutApplicationValues } from "./useApplicationData"

const schema: ApplicationFormSchema = {
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
      target: "human",
    },
    scholarship_request: {
      type: "boolean",
      label: "Scholarship",
      required: false,
      target: "application",
    },
    gender: {
      type: "select",
      label: "Gender",
      required: true,
      target: "human",
      options: ["Female", "Male", "Specify"],
    },
  },
  custom_fields: {
    favorite_color: {
      type: "text",
      label: "Favorite color",
      required: false,
    },
    document_id: {
      type: "text",
      label: "Document",
      required: false,
      section_id: "_unsectioned_base",
    },
  },
  sections: [],
}

describe("hydrateCheckoutApplicationValues", () => {
  it("hydrates checkout-visible base profile values for the current popup", () => {
    const human = {
      email: "human@example.com",
      first_name: "Human",
      gender: "Female",
    } as HumanPublic

    const application = {
      popup_id: "popup-1",
      human: {
        first_name: "Applicant",
        gender: "SYO - Non binary",
      },
      scholarship_request: true,
      custom_fields: {
        favorite_color: "Blue",
        document_id: "A-123",
      },
    } as unknown as ApplicationPublic

    expect(
      hydrateCheckoutApplicationValues({
        schema,
        human,
        application,
        popupId: "popup-1",
      }),
    ).toEqual({
      custom_document_id: "A-123",
      custom_favorite_color: "Blue",
      email: "human@example.com",
      first_name: "Applicant",
      gender: "SYO - Non binary",
      gender_specify: "Non binary",
      email_verified: true,
    })
  })

  it("limits imported values to human-target fields when the application belongs to another popup", () => {
    const human = {
      email: "human@example.com",
      first_name: "Human",
      gender: "Male",
    } as HumanPublic

    const application = {
      popup_id: "popup-2",
      human: {
        first_name: "Imported",
        gender: "Male",
      },
      scholarship_request: true,
      custom_fields: {
        favorite_color: "Blue",
      },
    } as unknown as ApplicationPublic

    expect(
      hydrateCheckoutApplicationValues({
        schema,
        human,
        application,
        popupId: "popup-1",
      }),
    ).toEqual({
      custom_document_id: "",
      custom_favorite_color: "",
      email: "human@example.com",
      first_name: "Imported",
      gender: "Male",
      gender_specify: "",
      email_verified: true,
    })
  })
})
