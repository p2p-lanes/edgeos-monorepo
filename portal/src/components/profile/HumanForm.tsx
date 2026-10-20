import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Loader2,
  Mail,
  Save,
  Upload,
  User,
  X,
} from "lucide-react"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { RiTelegram2Line } from "react-icons/ri"
import type { HumanSelfPublic } from "@/client"
import SelectForm from "@/components/ui/Form/Select"
import uploadFileToS3 from "@/helpers/upload"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import { imageOptimization } from "@/lib/image-optimization"
import { useCityProvider } from "@/providers/cityProvider"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { Input } from "../ui/input"
import { Label } from "../ui/label"

const DEFAULT_AGE_OPTIONS = ["18-24", "25-34", "35-44", "45-54", "55+"]
const DEFAULT_GENDER_OPTIONS = ["Male", "Female", "Non-binary", "Specify"]

const HumanForm = ({
  userData,
  isEditing,
  setIsEditing,
  handleSave,
  handleCancel,
  editForm,
  setEditForm,
}: {
  userData: HumanSelfPublic | null
  isEditing: boolean
  setIsEditing: (isEditing: boolean) => void
  handleSave: () => void
  handleCancel: () => void
  editForm: any
  setEditForm: (editForm: any) => void
}) => {
  const { t } = useTranslation()
  const popupId = useCityProvider().getCity()?.id
  const { data: applicationSchema } = useApplicationSchema(popupId)
  const [isHovering, setIsHovering] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showLinkedEmails, setShowLinkedEmails] = useState(false)
  const [specifyingGender, setSpecifyingGender] = useState(false)
  const ageOptions =
    applicationSchema?.base_fields.age?.options ?? DEFAULT_AGE_OPTIONS
  const genderOptions =
    applicationSchema?.base_fields.gender?.options ?? DEFAULT_GENDER_OPTIONS
  const currentAge = editForm.age ?? ""
  const currentGender = editForm.gender ?? ""
  const hasCustomGender =
    Boolean(currentGender) && !genderOptions.includes(currentGender)
  const canSpecifyGender = genderOptions.includes("Specify")
  const showGenderSpecify =
    canSpecifyGender && (specifyingGender || hasCustomGender)
  const hasRequiredNames = Boolean(
    editForm.first_name?.trim() && editForm.last_name?.trim(),
  )
  const canSave =
    hasRequiredNames &&
    (!showGenderSpecify ||
      (Boolean(currentGender.trim()) && currentGender !== "Specify"))
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) setSpecifyingGender(false)
  }, [isEditing])

  const genderLabel = (option: string) => {
    const key: Record<string, string> = {
      Male: "form.gender_male",
      Female: "form.gender_female",
      "Non-binary": "form.gender_non_binary",
      Specify: "form.gender_specify_own",
      "Prefer not to say": "form.gender_prefer_not",
    }
    return key[option] ? t(key[option]) : option
  }

  const profileFieldLabel = (field: "gender" | "age" | "residence") =>
    field === "gender" ? t("form.gender") : t(`profile.${field}`)

  // LEGACY: linked_emails removed from API – review for deletion
  const filteredLinkedEmails: string[] = []

  const _formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      alert(t("profile.image_invalid"))
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      alert(t("profile.image_too_large"))
      return
    }

    try {
      setIsUploading(true)
      setIsEditing(true)
      const imageUrl = await uploadFileToS3(file)

      setEditForm({ ...editForm, picture_url: imageUrl })
    } catch (_error) {
      alert(t("profile.image_upload_error"))
    } finally {
      setIsUploading(false)
      if (event.target) {
        event.target.value = ""
      }
    }
  }

  return (
    <Card className="p-4 md:p-6 bg-card mb-8 flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between">
      <div className="flex items-center gap-4 order-1 md:order-1 mb-6 md:mb-0">
        <div className="relative">
          <button
            type="button"
            className="relative w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-blue-200 group"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={handleAvatarClick}
          >
            {userData?.picture_url || editForm?.picture_url ? (
              <Image
                src={editForm?.picture_url || userData?.picture_url}
                alt="Profile"
                fill
                sizes="64px"
                className="rounded-full object-cover"
                {...imageOptimization(
                  editForm?.picture_url || userData?.picture_url,
                )}
              />
            ) : (
              <User className="w-8 h-8 text-primary" />
            )}

            {(isHovering || isUploading) && (
              <div className="absolute inset-0 bg-foreground/50 rounded-full flex items-center justify-center transition-all duration-200">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 text-background animate-spin" />
                ) : (
                  <Upload className="w-6 h-6 text-background" />
                )}
              </div>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground">
            {userData?.first_name} {userData?.last_name}
          </h2>
          <p className="text-sm md:text-base text-muted-foreground">
            {userData?.email}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end md:justify-start w-full md:w-auto order-3 md:order-2 md:ml-auto">
        {!isEditing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="w-full md:w-auto text-foreground border-border hover:bg-muted bg-transparent"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            {t("profile.edit_profile")}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-foreground border-border hover:bg-muted bg-transparent"
            >
              <X className="w-4 h-4 mr-2" />
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save className="w-4 h-4 mr-2" />
              {t("common.save")}
            </Button>
          </>
        )}
      </div>

      <div className="w-full order-2 md:order-3 md:mt-6 mb-6 md:mb-0">
        {!isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {userData?.email && (
              <div className="flex items-start md:items-center gap-3">
                <Mail className="w-5 h-5 text-muted-foreground mt-0.5 md:mt-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground">
                    {t("common.email")}
                  </p>
                  <p className="text-foreground break-all">{userData?.email}</p>
                  {filteredLinkedEmails.length > 0 && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => setShowLinkedEmails(!showLinkedEmails)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showLinkedEmails ? (
                          <>
                            <ChevronUp className="w-3 h-3" />
                            {t("profile.hide_linked_emails")}
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            {t("profile.linked_email", {
                              count: filteredLinkedEmails.length,
                            })}
                          </>
                        )}
                      </button>
                      {showLinkedEmails && (
                        <div className="mt-1 space-y-0.5">
                          {filteredLinkedEmails.map((email) => (
                            <p
                              key={email}
                              className="text-xs text-muted-foreground break-all"
                            >
                              {email}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {(["gender", "age", "residence"] as const).map((field) =>
              userData?.[field] ? (
                <div key={field} className="flex items-center gap-3">
                  <User className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {profileFieldLabel(field)}
                    </p>
                    <p className="text-foreground">{userData[field]}</p>
                  </div>
                </div>
              ) : null,
            )}
            {/* LEGACY: x_user removed from API – review for deletion */}
            {userData?.telegram && (
              <div className="flex items-center gap-3">
                <RiTelegram2Line className="w-5 h-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">
                    {t("form.telegram")}
                  </p>
                  <p className="text-foreground break-words">
                    {userData?.telegram}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("profile.basic_information")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("profile.basic_information_description")}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name">
                    {t("form.first_name")}
                    <span className="ml-1 text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="first_name"
                    autoComplete="given-name"
                    required
                    aria-required="true"
                    value={editForm.first_name ?? ""}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        first_name: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name">
                    {t("form.last_name")}
                    <span className="ml-1 text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <Input
                    id="last_name"
                    autoComplete="family-name"
                    required
                    aria-required="true"
                    value={editForm.last_name ?? ""}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        last_name: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              {!hasRequiredNames && (
                <output className="text-xs text-muted-foreground">
                  {t("profile.name_required_hint")}
                </output>
              )}
            </section>

            <section className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("profile.additional_details")}
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="telegram">{t("form.telegram")}</Label>
                  <Input
                    id="telegram"
                    autoComplete="off"
                    value={editForm.telegram ?? ""}
                    onChange={(event) =>
                      setEditForm({ ...editForm, telegram: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <SelectForm
                    id="gender"
                    label={profileFieldLabel("gender")}
                    value={showGenderSpecify ? "Specify" : currentGender}
                    placeholder={t("profile.select_option")}
                    options={[
                      { value: "__unset__", label: t("profile.not_specified") },
                      ...genderOptions.map((option) => ({
                        value: option,
                        label: genderLabel(option),
                      })),
                      ...(!canSpecifyGender && hasCustomGender
                        ? [{ value: currentGender, label: currentGender }]
                        : []),
                    ]}
                    onChange={(value) => {
                      if (value === "Specify") {
                        setSpecifyingGender(true)
                        setEditForm({
                          ...editForm,
                          gender: hasCustomGender ? currentGender : "",
                        })
                        return
                      }
                      setSpecifyingGender(false)
                      setEditForm({
                        ...editForm,
                        gender: value === "__unset__" ? "" : value,
                      })
                    }}
                  />
                  {showGenderSpecify && (
                    <div className="space-y-1.5">
                      <Label htmlFor="gender_specify">
                        {t("form.gender_specify")}
                      </Label>
                      <Input
                        id="gender_specify"
                        value={currentGender === "Specify" ? "" : currentGender}
                        onChange={(event) =>
                          setEditForm({
                            ...editForm,
                            gender: event.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
                <SelectForm
                  id="age"
                  label={profileFieldLabel("age")}
                  value={currentAge}
                  placeholder={t("profile.select_option")}
                  options={[
                    { value: "__unset__", label: t("profile.not_specified") },
                    ...ageOptions.map((option) => ({
                      value: option,
                      label: option,
                    })),
                    ...(currentAge && !ageOptions.includes(currentAge)
                      ? [{ value: currentAge, label: currentAge }]
                      : []),
                  ]}
                  onChange={(value) =>
                    setEditForm({
                      ...editForm,
                      age: value === "__unset__" ? "" : value,
                    })
                  }
                />
                <div className="space-y-1.5">
                  <Label htmlFor="residence">
                    {profileFieldLabel("residence")}
                  </Label>
                  <Input
                    id="residence"
                    value={editForm.residence ?? ""}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        residence: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </Card>
  )
}
export default HumanForm
