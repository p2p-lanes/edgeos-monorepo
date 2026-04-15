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
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { RiTelegram2Line } from "react-icons/ri"
import type { HumanPublic } from "@/client"
import uploadFileToS3 from "@/helpers/upload"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { Input } from "../ui/input"
import { Label } from "../ui/label"

const HumanForm = ({
  userData,
  isEditing,
  setIsEditing,
  handleSave,
  handleCancel,
  editForm,
  setEditForm,
}: {
  userData: HumanPublic | null
  isEditing: boolean
  setIsEditing: (isEditing: boolean) => void
  handleSave: () => void
  handleCancel: () => void
  editForm: any
  setEditForm: (editForm: any) => void
}) => {
  const { t } = useTranslation()
  const [isHovering, setIsHovering] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showLinkedEmails, setShowLinkedEmails] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    <Card className="p-4 md:p-6 bg-white mb-8 flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between">
      <div className="flex items-center gap-4 order-1 md:order-1 mb-6 md:mb-0">
        <div className="relative">
          <button
            type="button"
            className="relative w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-blue-200 group"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={handleAvatarClick}
          >
            {userData?.picture_url || editForm?.picture_url ? (
              <Image
                src={editForm?.picture_url || userData?.picture_url}
                alt="Profile"
                fill
                className="rounded-full object-cover"
              />
            ) : (
              <User className="w-8 h-8 text-blue-600" />
            )}

            {(isHovering || isUploading) && (
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center transition-all duration-200">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <Upload className="w-6 h-6 text-white" />
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
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">
            {userData?.first_name} {userData?.last_name}
          </h2>
          <p className="text-sm md:text-base text-gray-600">
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
            className="w-full md:w-auto text-gray-700 border-gray-300 hover:bg-gray-50"
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
              className="text-gray-700 border-gray-300 hover:bg-gray-50 bg-transparent"
            >
              <X className="w-4 h-4 mr-2" />
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
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
                <Mail className="w-5 h-5 text-gray-400 mt-0.5 md:mt-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-600">{t("common.email")}</p>
                  <p className="text-gray-900 break-all">{userData?.email}</p>
                  {filteredLinkedEmails.length > 0 && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => setShowLinkedEmails(!showLinkedEmails)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
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
                              className="text-xs text-gray-500 break-all"
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
            {/* {userData?.gender && (
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-600">Gender</p>
                <p className="text-gray-900">{userData?.gender}</p>
              </div>
            </div>
          )} */}
            {/* LEGACY: x_user removed from API – review for deletion */}
            {userData?.telegram && (
              <div className="flex items-center gap-3">
                <RiTelegram2Line className="w-5 h-5 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-600">{t("form.telegram")}</p>
                  <p className="text-gray-900 break-words">
                    {userData?.telegram}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-4">
              <div>
                <Label
                  htmlFor="first_name"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("form.first_name")}
                </Label>
                <Input
                  id="first_name"
                  value={editForm.first_name ?? ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, first_name: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label
                  htmlFor="last_name"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("form.last_name")}
                </Label>
                <Input
                  id="last_name"
                  value={editForm.last_name ?? ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, last_name: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="space-y-4">
              {/* LEGACY: x_user removed from API – review for deletion */}
              <div>
                <Label
                  htmlFor="telegram"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("form.telegram")}
                </Label>
                <Input
                  id="telegram"
                  value={editForm.telegram ?? ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, telegram: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
export default HumanForm
