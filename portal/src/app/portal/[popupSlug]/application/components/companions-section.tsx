"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Plus, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CompanionCreate } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import CheckboxForm from "@/components/ui/Form/Checkbox"
import InputForm from "@/components/ui/Form/Input"
import SelectForm from "@/components/ui/Form/Select"
import { LabelMuted } from "@/components/ui/label"
import SectionWrapper from "./SectionWrapper"
import { SectionSeparator } from "./section-separator"

export interface CompanionWithId extends CompanionCreate {
  _id: string
}

function useGenderOptions() {
  const { t } = useTranslation()
  return [
    { value: "Male", label: t("form.gender_male") },
    { value: "Female", label: t("form.gender_female") },
    { value: "Prefer not to say", label: t("form.gender_prefer_not") },
  ]
}

const animationProps = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: "easeInOut" },
}

interface CompanionsSectionProps {
  allowsSpouse: boolean
  allowsChildren: boolean
  companions: CompanionWithId[]
  onCompanionsChange: (companions: CompanionWithId[]) => void
}

export function CompanionsSection({
  allowsSpouse,
  allowsChildren,
  companions,
  onCompanionsChange,
}: CompanionsSectionProps) {
  const { t } = useTranslation()
  const genderOptions = useGenderOptions()
  const [hasSpouse, setHasSpouse] = useState(
    companions.some((c) => c.category === "spouse"),
  )
  const [hasKids, setHasKids] = useState(
    companions.some((c) => c.category === "kid"),
  )
  const [showKidModal, setShowKidModal] = useState(false)
  const [kidName, setKidName] = useState("")
  const [kidGender, setKidGender] = useState("")

  // Sync checkboxes when companions are loaded from existing application
  useEffect(() => {
    const hasSpouseData = companions.some((c) => c.category === "spouse")
    const hasKidsData = companions.some((c) => c.category === "kid")
    setHasSpouse(hasSpouseData)
    setHasKids(hasKidsData)
  }, [companions])

  if (!allowsSpouse && !allowsChildren) return null

  const spouse = companions.find((c) => c.category === "spouse")
  const kids = companions.filter((c) => c.category === "kid")

  const updateCompanion = (id: string, updates: Partial<CompanionCreate>) => {
    onCompanionsChange(
      companions.map((c) => (c._id === id ? { ...c, ...updates } : c)),
    )
  }

  const removeCompanion = (id: string) => {
    onCompanionsChange(companions.filter((c) => c._id !== id))
  }

  const handleToggleSpouse = (checked: boolean) => {
    setHasSpouse(checked)
    if (checked) {
      onCompanionsChange([
        ...companions,
        {
          _id: crypto.randomUUID(),
          name: "",
          category: "spouse",
          email: "",
          gender: "",
        },
      ])
    } else {
      onCompanionsChange(companions.filter((c) => c.category !== "spouse"))
    }
  }

  const handleToggleKids = (checked: boolean) => {
    setHasKids(checked)
    if (!checked) {
      onCompanionsChange(companions.filter((c) => c.category !== "kid"))
    }
  }

  const addKid = () => {
    if (!kidName.trim()) return
    onCompanionsChange([
      ...companions,
      {
        _id: crypto.randomUUID(),
        name: kidName.trim(),
        category: "kid",
        gender: kidGender || undefined,
      },
    ])
    setKidName("")
    setKidGender("")
    setShowKidModal(false)
  }

  return (
    <>
      <SectionWrapper title={t("companions.title")}>
        <div className="flex flex-col gap-4">
          {allowsSpouse && (
            <div>
              <CheckboxForm
                label={t("companions.bringing_spouse")}
                id="brings_spouse"
                checked={hasSpouse}
                onCheckedChange={handleToggleSpouse}
              />
              <AnimatePresence>
                {hasSpouse && spouse && (
                  <motion.div {...animationProps}>
                    <div className="flex flex-col gap-6 mt-6">
                      <InputForm
                        label={t("companions.spouse_name")}
                        id="spouse_name"
                        value={spouse.name}
                        onChange={(v) =>
                          updateCompanion(spouse._id, { name: v })
                        }
                        isRequired
                        subtitle={t("companions.spouse_approval")}
                      />
                      <InputForm
                        label={t("companions.spouse_email")}
                        id="spouse_email"
                        type="email"
                        value={spouse.email ?? ""}
                        onChange={(v) =>
                          updateCompanion(spouse._id, { email: v })
                        }
                        isRequired
                        subtitle={t("companions.spouse_email_help")}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {allowsChildren && (
            <div>
              <CheckboxForm
                label={t("companions.bringing_kids")}
                id="brings_kids"
                checked={hasKids}
                onCheckedChange={handleToggleKids}
              />
              <AnimatePresence>
                {hasKids && (
                  <motion.div {...animationProps}>
                    <div className="mt-4">
                      <LabelMuted className="text-sm text-muted-foreground mb-4 block">
                        {t("companions.kids_approval")}
                      </LabelMuted>

                      {kids.length > 0 && (
                        <div className="mb-4 space-y-2">
                          {kids.map((kid) => (
                            <div
                              key={kid._id}
                              className="flex items-center justify-between bg-gray-50 p-3 rounded-lg"
                            >
                              <span className="text-sm">
                                {kid.name}
                                {kid.gender ? ` - ${kid.gender}` : ""}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCompanion(kid._id)}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowKidModal(true)}
                        className="flex items-center gap-2"
                      >
                        <Plus size={16} />
                        {t("companions.add_kid")}
                      </Button>

                      <Dialog
                        open={showKidModal}
                        onOpenChange={setShowKidModal}
                      >
                        <DialogContent className="sm:max-w-[425px] bg-white">
                          <DialogHeader>
                            <DialogTitle>
                              {t("companions.add_child")}
                            </DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <InputForm
                              label={t("companions.child_name")}
                              id="kid_name"
                              value={kidName}
                              onChange={setKidName}
                              isRequired
                              placeholder={t(
                                "companions.child_name_placeholder",
                              )}
                            />
                            <SelectForm
                              label={t("companions.child_gender")}
                              id="kid_gender"
                              value={kidGender}
                              onChange={setKidGender}
                              options={genderOptions}
                              placeholder={t("companions.child_gender_select")}
                            />
                          </div>
                          <DialogFooter className="flex flex-col gap-4 md:flex-row">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setKidName("")
                                setKidGender("")
                                setShowKidModal(false)
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                            <Button
                              type="button"
                              onClick={addKid}
                              disabled={!kidName.trim()}
                            >
                              {t("companions.add_child")}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </SectionWrapper>
      <SectionSeparator />
    </>
  )
}
