import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { GroupMemberPublic } from "@/client"
import { GroupsService } from "@/client"
import { Button } from "@/components/ui/button"
import { FormInputWrapper } from "@/components/ui/form-input-wrapper"
import { Input } from "@/components/ui/input"
import { LabelRequired } from "@/components/ui/label"
import Modal from "@/components/ui/modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GENDER_OPTIONS } from "@/constants/util"

interface MemberFormModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  member?: GroupMemberPublic
}

interface FormData {
  first_name: string
  last_name: string
  email: string
  telegram: string | null
  gender: string | null
}

const MemberFormModal = ({
  open,
  onClose,
  onSuccess,
  member,
}: MemberFormModalProps) => {
  const { t } = useTranslation()
  const { group_id } = useParams() as { group_id: string }
  const isEditMode = !!member

  const [formData, setFormData] = useState<FormData>({
    first_name: "",
    last_name: "",
    email: "",
    telegram: null,
    gender: null,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Cargar datos del miembro si estamos en modo edición
  useEffect(() => {
    if (member) {
      setFormData({
        first_name: member.first_name || "",
        last_name: member.last_name || "",
        email: member.email || "",
        telegram: member.telegram || "",
        gender: member.gender || "",
      })
    }
  }, [member])

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData({
      ...formData,
      [field]: value,
    })

    // Clear error when user types
    if (errors[field]) {
      setErrors({
        ...errors,
        [field]: "",
      })
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    // In edit mode the full profile is editable; in add mode it is an email
    // invitation, so only the email matters.
    if (isEditMode) {
      if (!formData.first_name.trim()) {
        newErrors.first_name = t("form.first_name_required")
      }
      if (!formData.last_name.trim()) {
        newErrors.last_name = t("form.last_name_required")
      }
    }

    if (!formData.email.trim()) {
      newErrors.email = t("form.email_required")
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = t("form.email_invalid_format")
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      // Convertir campos vacíos a null
      const processedData = Object.entries(formData).reduce(
        (acc, [key, value]) => {
          acc[key as keyof FormData] =
            typeof value === "string" && value.trim().length === 0
              ? null
              : value
          return acc
        },
        {} as FormData,
      )

      if (isEditMode && member) {
        await GroupsService.updateGroupMember({
          groupId: group_id,
          humanId: member.id,
          requestBody: processedData,
        })
        toast.success(t("groups.member_updated"))
      } else {
        const result = await GroupsService.addGroupMember({
          groupId: group_id,
          requestBody: {
            email: processedData.email ?? "",
          },
        })
        if (result.status === "invited") {
          toast.success(t("groups.member_invited"))
        } else {
          toast.success(t("groups.member_added"))
        }
      }

      // Reset form
      if (!isEditMode) {
        setFormData({
          first_name: "",
          last_name: "",
          email: "",
          telegram: null,
          gender: null,
        })
      }

      // Call success callback if provided
      if (onSuccess) {
        onSuccess()
      } else {
        onClose()
      }
    } catch (error: unknown) {
      console.error(
        `Error ${isEditMode ? "updating" : "adding"} member:`,
        error,
      )
      toast.error(
        isEditMode
          ? t("groups.member_update_failed")
          : t("groups.member_add_failed"),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditMode ? t("groups.edit_member") : t("groups.invite_member")}
      description={
        isEditMode
          ? t("groups.edit_member_description")
          : t("groups.invite_member_description")
      }
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {isEditMode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* First Name */}
            <FormInputWrapper>
              <LabelRequired htmlFor="first_name" isRequired={true}>
                {t("groups.first_name")}
              </LabelRequired>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) =>
                  handleInputChange("first_name", e.target.value)
                }
                error={errors.first_name}
              />
              {errors.first_name && (
                <p className="text-red-500 text-sm">{errors.first_name}</p>
              )}
            </FormInputWrapper>

            {/* Last Name */}
            <FormInputWrapper>
              <LabelRequired htmlFor="last_name" isRequired={true}>
                {t("groups.last_name")}
              </LabelRequired>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => handleInputChange("last_name", e.target.value)}
                error={errors.last_name}
              />
              {errors.last_name && (
                <p className="text-red-500 text-sm">{errors.last_name}</p>
              )}
            </FormInputWrapper>
          </div>
        )}

        {/* Email */}
        <FormInputWrapper>
          <LabelRequired htmlFor="email" isRequired={true}>
            {t("groups.email")}
          </LabelRequired>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange("email", e.target.value)}
            error={errors.email}
            disabled={isEditMode}
          />
          {errors.email && (
            <p className="text-red-500 text-sm">{errors.email}</p>
          )}
          {!isEditMode && (
            <p className="text-muted-foreground text-sm">
              {t("groups.invite_email_help")}
            </p>
          )}
        </FormInputWrapper>

        {isEditMode && (
          <>
            {/* Telegram */}
            <FormInputWrapper>
              <LabelRequired htmlFor="telegram" isRequired={false}>
                {t("groups.telegram")}
              </LabelRequired>
              <Input
                id="telegram"
                value={formData.telegram || ""}
                onChange={(e) => handleInputChange("telegram", e.target.value)}
              />
            </FormInputWrapper>

            {/* Gender */}
            <FormInputWrapper>
              <LabelRequired htmlFor="gender" isRequired={false}>
                {t("groups.gender")}
              </LabelRequired>
              <Select
                value={formData.gender || ""}
                onValueChange={(value) => handleInputChange("gender", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("groups.select_gender")} />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormInputWrapper>
          </>
        )}

        <div className="flex justify-end space-x-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t("groups.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isEditMode
                ? t("groups.updating")
                : t("groups.sending")
              : isEditMode
                ? t("groups.update_member")
                : t("groups.send_invitation")}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default MemberFormModal
