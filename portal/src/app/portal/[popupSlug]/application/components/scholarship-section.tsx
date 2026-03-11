"use client"

import { AnimatePresence, motion } from "framer-motion"
import CheckboxForm from "@/components/ui/Form/Checkbox"
import InputForm from "@/components/ui/Form/Input"
import TextAreaForm from "@/components/ui/Form/TextArea"
import type { FormFieldSchema } from "@/types/form-schema"
import SectionWrapper from "./SectionWrapper"
import { SectionSeparator } from "./section-separator"

const animationProps = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: "easeInOut" },
}

interface ScholarshipSectionInfo {
  id: string
  label: string
  description?: string | null
}

interface ScholarshipSectionProps {
  section?: ScholarshipSectionInfo
  fields: Record<string, FormFieldSchema>
  scholarshipRequest: boolean
  scholarshipDetails: string
  scholarshipVideoUrl: string
  detailsError?: string
  videoUrlError?: string
  onScholarshipRequestChange: (checked: boolean) => void
  onDetailsChange: (value: string) => void
  onVideoUrlChange: (value: string) => void
}

export function ScholarshipSection({
  section,
  fields,
  scholarshipRequest,
  scholarshipDetails,
  scholarshipVideoUrl,
  detailsError,
  videoUrlError,
  onScholarshipRequestChange,
  onDetailsChange,
  onVideoUrlChange,
}: ScholarshipSectionProps) {
  const title = section?.label ?? "Scholarship"
  const subtitle = section?.description ?? undefined

  const requestField = fields.scholarship_request
  const detailsField = fields.scholarship_details
  const videoField = fields.scholarship_video_url

  return (
    <>
      <SectionWrapper title={title} subtitle={subtitle}>
        <div className="flex flex-col gap-4">
          <CheckboxForm
            label={requestField?.label ?? "I am requesting a scholarship"}
            id="scholarship_request"
            checked={scholarshipRequest}
            onCheckedChange={onScholarshipRequestChange}
          />

          <AnimatePresence>
            {scholarshipRequest && (
              <motion.div {...animationProps}>
                <div className="flex flex-col gap-6">
                  <InputForm
                    label={videoField?.label ?? "Video URL (optional)"}
                    id="scholarship_video_url"
                    value={scholarshipVideoUrl}
                    onChange={onVideoUrlChange}
                    error={videoUrlError}
                    subtitle={videoField?.help_text ?? undefined}
                    type="url"
                    placeholder={videoField?.placeholder ?? "https://..."}
                  />
                  <TextAreaForm
                    label={
                      detailsField?.label ??
                      "Please tell us why you need financial support"
                    }
                    id="scholarship_details"
                    value={scholarshipDetails}
                    error={detailsError ?? ""}
                    handleChange={onDetailsChange}
                    isRequired
                    placeholder={
                      detailsField?.placeholder ??
                      "Describe your financial situation..."
                    }
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SectionWrapper>
      <SectionSeparator />
    </>
  )
}
