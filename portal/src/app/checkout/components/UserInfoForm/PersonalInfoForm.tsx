import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import InputForm, { AddonInputForm } from "@/components/ui/Form/Input"
import RadioGroupForm from "@/components/ui/Form/RadioGroup"
import { Input } from "@/components/ui/input"
import { LabelRequired } from "@/components/ui/label"
import { GENDER_OPTIONS } from "@/constants/util"
import { useCityProvider } from "@/providers/cityProvider"

interface PersonalInfoFormProps {
  formData: {
    first_name: string
    last_name: string
    telegram: string
    organization: string | null
    role: string | null
    gender: string
    email: string
    local_resident: string
  }
  handleInputChange: (field: string, value: string) => void
  handleChangeEmail?: () => void
  errors: Record<string, string>
}

const PersonalInfoForm = ({
  formData,
  handleInputChange,
  handleChangeEmail,
  errors,
}: PersonalInfoFormProps) => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const isDayCheckout = searchParams.has("day-passes")
  const { getCity } = useCityProvider()
  const _city = getCity()
  // Estado para almacenar el valor de género normalizado
  const [customGender, setCustomGender] = useState<string>("")
  const [genderValue, setGenderValue] = useState<string>("")
  useEffect(() => {
    if (formData.gender) {
      const matchingOption = GENDER_OPTIONS.find(
        (opt) => opt.value.toLowerCase() === formData.gender.toLowerCase(),
      )
      if (matchingOption) {
        setGenderValue(matchingOption.value)
      } else {
        setGenderValue("Specify")
        const gender = formData.gender.split(" - ")[1]
        setCustomGender(gender)
      }
    } else {
      setGenderValue("")
    }
  }, [formData.gender])

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Email con botón para cambiar */}
      <div className="w-full flex items-center justify-between">
        <div className="w-full flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <LabelRequired isRequired={false}>
              {t("common.email")}
            </LabelRequired>
          </div>
          <Input
            id="email-verified"
            type="email"
            value={formData.email}
            onChange={() => {}} // No se puede cambiar
            disabled={true}
            className="w-full"
          />
        </div>

        {handleChangeEmail && (
          <Button
            type="button"
            variant="link"
            size="default"
            className="mt-[21px]"
            onClick={handleChangeEmail}
          >
            {t("form.change_email")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InputForm
          label={t("form.first_name")}
          id="first_name"
          value={formData.first_name}
          onChange={(value) => handleInputChange("first_name", value)}
          error={errors.first_name}
          isRequired
          placeholder={t("form.first_name_placeholder")}
        />

        <InputForm
          label={t("form.last_name")}
          id="last_name"
          value={formData.last_name}
          onChange={(value) => handleInputChange("last_name", value)}
          error={errors.last_name}
          isRequired
          placeholder={t("form.last_name_placeholder")}
        />
      </div>

      <AddonInputForm
        label={t("form.telegram")}
        id="telegram"
        addon="@"
        value={formData.telegram}
        onChange={(value) => handleInputChange("telegram", value)}
        error={errors.telegram}
        isRequired
        placeholder={t("form.telegram_placeholder")}
      />

      {!isDayCheckout && (
        <>
          <InputForm
            label={t("form.organization")}
            id="organization"
            value={formData.organization || ""}
            onChange={(value) => handleInputChange("organization", value)}
            error={errors.organization}
            isRequired
            placeholder={t("form.organization_placeholder")}
          />

          <InputForm
            label={t("form.role")}
            id="role"
            value={formData.role || ""}
            onChange={(value) => handleInputChange("role", value)}
            error={errors.role}
            isRequired
            placeholder={t("form.role_placeholder")}
          />
        </>
      )}

      {/* <SelectForm
        label={form?.personal_information?.local_resident_title || "Are you a LATAM citizen / San Martin resident?"}
        id="local_resident"
        value={formData.local_resident}
        onChange={(value) => {
          if (value === formData.local_resident) return;
          handleInputChange("local_resident", value);
        }}
        error={errors.local_resident}
        isRequired
        placeholder="Select..."
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
      />   */}

      <RadioGroupForm
        label={t("form.gender")}
        subtitle={t("form.gender_select")}
        value={genderValue}
        onChange={(value) => {
          setGenderValue(value)
          handleInputChange("gender", value)
        }}
        error={errors.gender}
        isRequired
        options={GENDER_OPTIONS}
      />

      {genderValue === "Specify" && (
        <InputForm
          label={t("form.gender_specify")}
          id="gender_specify"
          value={customGender}
          onChange={(value) => {
            setCustomGender(value)
            handleInputChange("gender", `SYO - ${value}`)
          }}
          error={errors.gender_specify}
          isRequired
          placeholder={t("form.gender_specify_placeholder")}
        />
      )}
    </div>
  )
}

export default PersonalInfoForm
